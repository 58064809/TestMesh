package testmesh.release

default decision := {"status": "deny", "reasons": ["发布策略没有产生有效结果"], "checks": []}

hard_failures contains "质量计划尚未批准" if input.plan_status != "approved"
hard_failures contains "未关联已批准的需求基线" if {
  input.rules.requireApprovedBaseline
  not input.assets.baselineApproved
}
hard_failures contains "未关联 Approved Test Model 版本" if {
  input.rules.requireApprovedTestModel
  not input.assets.testModelApproved
}
hard_failures contains "未关联 Approved TestCase 版本" if {
  input.rules.requireApprovedTestCases
  not input.assets.testCasesApproved
}
hard_failures contains reason if {
  input.metrics.requirementCoveragePct < input.rules.minimumRequirementCoveragePct
  reason := sprintf("需求覆盖率 %v%% 低于门槛 %v%%", [input.metrics.requirementCoveragePct, input.rules.minimumRequirementCoveragePct])
}
hard_failures contains reason if {
  input.metrics.traceabilityCompletenessPct < input.rules.minimumTraceabilityCompletenessPct
  reason := sprintf("追溯完整度 %v%% 低于门槛 %v%%", [input.metrics.traceabilityCompletenessPct, input.rules.minimumTraceabilityCompletenessPct])
}
hard_failures contains reason if {
  input.metrics.testDataSpecificationCoveragePct < input.rules.minimumTestDataSpecificationCoveragePct
  reason := sprintf("测试数据设计覆盖率 %v%% 低于门槛 %v%%", [input.metrics.testDataSpecificationCoveragePct, input.rules.minimumTestDataSpecificationCoveragePct])
}
hard_failures contains reason if {
  input.metrics.assertionDesignCoveragePct < input.rules.minimumAssertionDesignCoveragePct
  reason := sprintf("断言设计覆盖率 %v%% 低于门槛 %v%%", [input.metrics.assertionDesignCoveragePct, input.rules.minimumAssertionDesignCoveragePct])
}
hard_failures contains reason if {
  input.metrics.approvedTestCases > 0
  input.metrics.executionCompletenessPct < input.rules.minimumExecutionCompletenessPct
  reason := sprintf("执行完整率 %v%% 低于门槛 %v%%", [input.metrics.executionCompletenessPct, input.rules.minimumExecutionCompletenessPct])
}
hard_failures contains reason if {
  input.metrics.executionCount > 0
  input.metrics.executionPassRatePct < input.rules.minimumExecutionPassRatePct
  reason := sprintf("执行通过率 %v%% 低于门槛 %v%%", [input.metrics.executionPassRatePct, input.rules.minimumExecutionPassRatePct])
}
hard_failures contains reason if {
  input.metrics.failedTests > input.rules.maximumFailedTests
  reason := sprintf("失败测试数 %d 超过允许值 %d", [input.metrics.failedTests, input.rules.maximumFailedTests])
}
hard_failures contains reason if {
  input.metrics.failedRunsRequiringTriage > 0
  input.metrics.failureTriageCoveragePct < input.rules.minimumFailureTriageCoveragePct
  reason := sprintf("失败定位覆盖率 %v%% 低于门槛 %v%%", [input.metrics.failureTriageCoveragePct, input.rules.minimumFailureTriageCoveragePct])
}
hard_failures contains "缺少 API 自动化执行证据" if {
  input.rules.requireApiExecution
  input.metrics.apiExecutionCount == 0
}
hard_failures contains "缺少 UI 自动化执行证据" if {
  input.rules.requireUiExecution
  input.metrics.uiExecutionCount == 0
}
hard_failures contains "AI 质量评测配置尚未批准" if {
  input.rules.requireApprovedAiQualityProfile
  not input.assets.aiQualityProfileApproved
}
hard_failures contains reason if {
  input.metrics.requiredAiDimensions > 0
  count(input.metrics.missingAiDimensions) > 0
  reason := sprintf("Testing for AI 未覆盖质量计划要求的维度：%v", [concat("、", input.metrics.missingAiDimensions)])
}
hard_failures contains reason if {
  input.metrics.aiTestCases > 0
  not input.assets.aiEvaluationEvidenceLinked
  reason := sprintf("Testing for AI 尚未关联当前 Approved TestCase 版本的 Phoenix Dataset/Experiment/Evaluator 通过证据，缺少 %d 条 AI 用例评测", [count(input.metrics.missingAiEvaluationTestCaseIds)])
}

review_reasons contains reason if {
  input.metrics.openImprovementActions > input.rules.maximumOpenImprovementActions
  reason := sprintf("未关闭改进项 %d 个，超过门槛 %d 个", [input.metrics.openImprovementActions, input.rules.maximumOpenImprovementActions])
}

default execution_pass_rate_ok := false
execution_pass_rate_ok := true if input.metrics.executionCount == 0
execution_pass_rate_ok := true if input.metrics.executionPassRatePct >= input.rules.minimumExecutionPassRatePct

checks := [
  {"id": "plan", "passed": input.plan_status == "approved"},
  {"id": "baseline", "passed": input.assets.baselineApproved},
  {"id": "approved_test_model", "passed": input.assets.testModelApproved},
  {"id": "approved_testcases", "passed": input.assets.testCasesApproved},
  {"id": "requirement_coverage", "passed": input.metrics.requirementCoveragePct >= input.rules.minimumRequirementCoveragePct},
  {"id": "traceability", "passed": input.metrics.traceabilityCompletenessPct >= input.rules.minimumTraceabilityCompletenessPct},
  {"id": "test_data_design", "passed": input.metrics.testDataSpecificationCoveragePct >= input.rules.minimumTestDataSpecificationCoveragePct},
  {"id": "assertion_design", "passed": input.metrics.assertionDesignCoveragePct >= input.rules.minimumAssertionDesignCoveragePct},
  {"id": "execution_completeness", "passed": execution_completeness_ok},
  {"id": "execution_pass_rate", "passed": execution_pass_rate_ok},
  {"id": "failed_tests", "passed": input.metrics.failedTests <= input.rules.maximumFailedTests}
  ,{"id": "failure_triage", "passed": failure_triage_ok}
  ,{"id": "ai_test_coverage", "passed": ai_test_coverage_ok}
  ,{"id": "ai_evaluation_evidence", "passed": ai_evaluation_evidence_ok}
]

default ai_test_coverage_ok := false
ai_test_coverage_ok := true if input.metrics.requiredAiDimensions == 0
ai_test_coverage_ok := true if count(input.metrics.missingAiDimensions) == 0

default ai_evaluation_evidence_ok := false
ai_evaluation_evidence_ok := true if input.metrics.aiTestCases == 0
ai_evaluation_evidence_ok := true if input.assets.aiEvaluationEvidenceLinked

default execution_completeness_ok := false
execution_completeness_ok := true if input.metrics.approvedTestCases == 0
execution_completeness_ok := true if input.metrics.executionCompletenessPct >= input.rules.minimumExecutionCompletenessPct

default failure_triage_ok := false
failure_triage_ok := true if input.metrics.failedRunsRequiringTriage == 0
failure_triage_ok := true if input.metrics.failureTriageCoveragePct >= input.rules.minimumFailureTriageCoveragePct

decision := {"status": "deny", "reasons": sort([x | hard_failures[x]]), "checks": checks} if count(hard_failures) > 0
decision := {"status": "review", "reasons": sort([x | review_reasons[x]]), "checks": checks} if {
  count(hard_failures) == 0
  count(review_reasons) > 0
}
decision := {"status": "allow", "reasons": [], "checks": checks} if {
  count(hard_failures) == 0
  count(review_reasons) == 0
}
