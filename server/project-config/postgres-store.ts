import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ProjectAutomationConfigInput, ProjectEnvironmentInput, ProjectInput } from "./schema.js";

export interface ProjectEnvironmentRecord extends ProjectEnvironmentInput {
  id: string;
  projectId: string;
  configProvider: "testmesh_non_secret" | "infisical";
  infisicalEnvironmentSlug: string;
  infisicalSecretPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord extends ProjectInput {
  id: string;
  infisicalProjectId: string;
  defaultApiEnvironmentId: string;
  defaultUiEnvironmentId: string;
  uiRepositoryPath: string;
  environments: ProjectEnvironmentRecord[];
  createdAt: string;
  updatedAt: string;
}

export class ProjectConfigPostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema: string) {}

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        infisical_project_id TEXT NOT NULL DEFAULT '',
        default_api_environment_id TEXT NOT NULL DEFAULT '',
        default_ui_environment_id TEXT NOT NULL DEFAULT '',
        ui_repository_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.project_environments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        headers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        config_provider TEXT NOT NULL DEFAULT 'testmesh_non_secret',
        infisical_environment_slug TEXT NOT NULL DEFAULT '',
        infisical_secret_path TEXT NOT NULL DEFAULT '/',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, name)
      );
    `);
    await this.pool.query(`ALTER TABLE ${this.schema}.projects ADD COLUMN IF NOT EXISTS default_api_environment_id TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.schema}.projects ADD COLUMN IF NOT EXISTS default_ui_environment_id TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.schema}.projects ADD COLUMN IF NOT EXISTS ui_repository_path TEXT NOT NULL DEFAULT ''`);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const result = await this.pool.query(`
      SELECT p.id, p.name, p.code, p.description, p.infisical_project_id,
             p.default_api_environment_id, p.default_ui_environment_id, p.ui_repository_path,
             p.created_at, p.updated_at,
             COALESCE(json_agg(json_build_object(
               'id', e.id, 'projectId', e.project_id, 'name', e.name,
               'baseUrl', e.base_url, 'headers', e.headers_json,
               'configProvider', e.config_provider,
               'infisicalEnvironmentSlug', e.infisical_environment_slug,
               'infisicalSecretPath', e.infisical_secret_path,
               'createdAt', e.created_at, 'updatedAt', e.updated_at
             ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS environments
      FROM ${this.schema}.projects p
      LEFT JOIN ${this.schema}.project_environments e ON e.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    return result.rows.map(mapProject);
  }

  async getProject(id: string): Promise<ProjectRecord> {
    const project = (await this.listProjects()).find((item) => item.id === id);
    if (!project) throw new Error(`项目 ${id} 不存在`);
    return project;
  }

  async createProject(input: ProjectInput): Promise<ProjectRecord> {
    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.schema}.projects (id, name, code, description) VALUES ($1, $2, $3, $4)`,
        [id, input.name, input.code, input.description],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`项目标识 ${input.code} 已存在`, { cause: error });
      throw error;
    }
    return this.getProject(id);
  }

  async updateProject(id: string, input: ProjectInput): Promise<ProjectRecord> {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.schema}.projects SET name = $2, code = $3, description = $4, updated_at = NOW() WHERE id = $1`,
        [id, input.name, input.code, input.description],
      );
      if (result.rowCount === 0) throw new Error(`项目 ${id} 不存在`);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`项目标识 ${input.code} 已存在`, { cause: error });
      throw error;
    }
    return this.getProject(id);
  }

  async updateAutomationConfig(id: string, input: ProjectAutomationConfigInput): Promise<ProjectRecord> {
    const project = await this.getProject(id);
    const environmentIds = new Set(project.environments.map((item) => item.id));
    if (input.defaultApiEnvironmentId && !environmentIds.has(input.defaultApiEnvironmentId)) throw new Error("默认 API 环境不属于所选项目");
    if (input.defaultUiEnvironmentId && !environmentIds.has(input.defaultUiEnvironmentId)) throw new Error("默认 UI 环境不属于所选项目");
    await this.pool.query(
      `UPDATE ${this.schema}.projects
       SET default_api_environment_id = $2, default_ui_environment_id = $3, ui_repository_path = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, input.defaultApiEnvironmentId, input.defaultUiEnvironmentId, input.uiRepositoryPath],
    );
    return this.getProject(id);
  }

  async createEnvironment(projectId: string, input: ProjectEnvironmentInput): Promise<ProjectEnvironmentRecord> {
    await this.getProject(projectId);
    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.schema}.project_environments
         (id, project_id, name, base_url, headers_json, config_provider, infisical_environment_slug, infisical_secret_path)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [id, projectId, input.name, input.baseUrl, JSON.stringify(input.headers), "testmesh_non_secret", "", "/"],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`环境名称 ${input.name} 已存在`, { cause: error });
      throw error;
    }
    return this.getEnvironment(projectId, id);
  }

  async updateEnvironment(projectId: string, id: string, input: ProjectEnvironmentInput): Promise<ProjectEnvironmentRecord> {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.schema}.project_environments
         SET name = $3, base_url = $4, headers_json = $5::jsonb, config_provider = $6,
             infisical_environment_slug = $7, infisical_secret_path = $8, updated_at = NOW()
         WHERE project_id = $1 AND id = $2`,
        [projectId, id, input.name, input.baseUrl, JSON.stringify(input.headers),
          "testmesh_non_secret", "", "/"],
      );
      if (result.rowCount === 0) throw new Error(`环境 ${id} 不存在`);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`环境名称 ${input.name} 已存在`, { cause: error });
      throw error;
    }
    return this.getEnvironment(projectId, id);
  }

  async getEnvironment(projectId: string, id: string): Promise<ProjectEnvironmentRecord> {
    const result = await this.pool.query(
      `SELECT id, project_id, name, base_url, headers_json, config_provider,
              infisical_environment_slug, infisical_secret_path, created_at, updated_at
       FROM ${this.schema}.project_environments WHERE project_id = $1 AND id = $2`,
      [projectId, id],
    );
    if (!result.rows[0]) throw new Error(`环境 ${id} 不存在或不属于所选项目`);
    return mapEnvironment(result.rows[0]);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id), name: String(row.name), code: String(row.code), description: String(row.description ?? ""),
    infisicalProjectId: String(row.infisical_project_id ?? ""),
    defaultApiEnvironmentId: String(row.default_api_environment_id ?? ""),
    defaultUiEnvironmentId: String(row.default_ui_environment_id ?? ""),
    uiRepositoryPath: String(row.ui_repository_path ?? ""),
    environments: Array.isArray(row.environments) ? row.environments.map((item) => mapEnvironment(item as Record<string, unknown>)) : [],
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapEnvironment(row: Record<string, unknown>): ProjectEnvironmentRecord {
  return {
    id: String(row.id), projectId: String(row.projectId ?? row.project_id), name: String(row.name),
    baseUrl: String(row.baseUrl ?? row.base_url),
    headers: Array.isArray(row.headers ?? row.headers_json) ? (row.headers ?? row.headers_json) as Array<{ name: string; value: string }> : [],
    configProvider: String(row.configProvider ?? row.config_provider) === "infisical" ? "infisical" : "testmesh_non_secret",
    infisicalEnvironmentSlug: String(row.infisicalEnvironmentSlug ?? row.infisical_environment_slug ?? ""),
    infisicalSecretPath: String(row.infisicalSecretPath ?? row.infisical_secret_path ?? "/"),
    createdAt: new Date(String(row.createdAt ?? row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updatedAt ?? row.updated_at)).toISOString(),
  };
}
