package testmesh.release

test_deny_without_approved_plan if {
  result := decision with input as sample_input("draft", 100, 100, 0, 0)
  result.status == "deny"
  count(result.checks) == 14
  "质量计划尚未批准" in result.reasons
}

test_allow_complete_release if {
  decision.status == "allow" with input as sample_input("approved", 100, 100, 0, 0)
}

test_review_open_improvements if {
  decision.status == "review" with input as sample_input("approved", 100, 100, 0, 1)
}

test_deny_missing_ai_test_dimensions if {
  candidate := object.union(sample_input("approved", 100, 100, 0, 0), {
    "metrics": object.union(sample_input("approved", 100, 100, 0, 0).metrics, {
      "requiredAiDimensions": 2,
      "missingAiDimensions": ["intent_recognition", "groundedness_hallucination"]
    })
  })
  result := decision with input as candidate
  result.status == "deny"
  contains(result.reasons[0], "Testing for AI")
}

test_deny_without_linked_phoenix_ai_evaluation if {
  candidate := object.union(sample_input("approved", 100, 100, 0, 0), {
    "assets": object.union(sample_input("approved", 100, 100, 0, 0).assets, {
      "aiEvaluationEvidenceLinked": false
    }),
    "metrics": object.union(sample_input("approved", 100, 100, 0, 0).metrics, {
      "aiTestCases": 2,
      "missingAiEvaluationTestCaseIds": ["TC-001", "TC-002"]
    })
  })
  result := decision with input as candidate
  result.status == "deny"
  some reason in result.reasons
  contains(reason, "Phoenix Dataset/Experiment/Evaluator")
}

test_deny_incomplete_execution if {
  candidate := object.union(sample_input("approved", 100, 100, 0, 0), {
    "metrics": object.union(sample_input("approved", 100, 100, 0, 0).metrics, {"executionCompletenessPct": 75})
  })
  result := decision with input as candidate
  result.status == "deny"
  some reason in result.reasons
  contains(reason, "执行完整率")
}

test_deny_failed_run_without_triage if {
  candidate := object.union(sample_input("approved", 100, 100, 0, 0), {
    "metrics": object.union(sample_input("approved", 100, 100, 0, 0).metrics, {
      "failedRunsRequiringTriage": 1,
      "failureTriageCoveragePct": 0
    })
  })
  result := decision with input as candidate
  result.status == "deny"
  some reason in result.reasons
  contains(reason, "失败定位覆盖率")
}

sample_input(status, coverage, pass_rate, failures, improvements) := {
  "plan_status": status,
  "assets": {"baselineApproved": true, "testModelApproved": true, "testCasesApproved": true, "aiQualityProfileApproved": true, "aiEvaluationEvidenceLinked": true},
  "metrics": {
    "requirementCoveragePct": coverage,
    "traceabilityCompletenessPct": 100,
    "testDataSpecificationCoveragePct": 100,
    "assertionDesignCoveragePct": 100,
    "approvedTestCases": 10,
    "executionCompletenessPct": 100,
    "executionCount": 1,
    "executionPassRatePct": pass_rate,
    "failedTests": failures,
    "failedRunsRequiringTriage": 0,
    "failureTriageCoveragePct": 100,
    "apiExecutionCount": 1,
    "uiExecutionCount": 1,
    "openImprovementActions": improvements
    ,"requiredAiDimensions": 0
    ,"missingAiDimensions": []
    ,"aiTestCases": 0
    ,"missingAiEvaluationTestCaseIds": []
  },
  "rules": {
    "requireApprovedBaseline": true,
    "requireApprovedTestModel": true,
    "requireApprovedTestCases": true,
    "minimumRequirementCoveragePct": 100,
    "minimumTraceabilityCompletenessPct": 100,
    "minimumTestDataSpecificationCoveragePct": 100,
    "minimumAssertionDesignCoveragePct": 100,
    "minimumExecutionCompletenessPct": 100,
    "minimumExecutionPassRatePct": 100,
    "minimumFailureTriageCoveragePct": 100,
    "maximumFailedTests": 0,
    "requireApiExecution": true,
    "requireUiExecution": true,
    "requireApprovedAiQualityProfile": true,
    "maximumOpenImprovementActions": 0
  }
}
