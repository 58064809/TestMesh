import { testReleasePolicy, verifyOpa } from "../server/quality-management/opa.js";

await verifyOpa();
await testReleasePolicy();
console.log("OPA release policy tests passed");
