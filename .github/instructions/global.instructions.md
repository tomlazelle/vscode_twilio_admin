# GitHub Code Review Standards

## Review Comment Resolution Rules

### Reviewer Expectations

When creating review comments:

* Keep comments specific and actionable.
* Explain:

  * what is wrong
  * why it is a problem
  * expected correction
* Prefer one issue per comment.
* Use severity prefixes when appropriate:

  * `[critical]`
  * `[high]`
  * `[medium]`
  * `[low]`
  * `[nit]`

Example:

```text
[high] This async database call is not awaited, which can cause silent task failures and connection leaks.
Expected fix: await the repository call and propagate cancellation tokens.
```

---

### Author Expectations

When a review issue is fixed:

1. Reply to the review comment with:

   * what changed
   * file(s) updated
   * any implementation notes

Example:

```text
Fixed.

Changes:
- Added await to repository call
- Added cancellation token propagation
- Updated unit test coverage

Files:
- services/customer_service.py
- tests/test_customer_service.py
```

2. Mark the conversation as resolved.
3. Collapse resolved conversations in GitHub UI.
4. Do not leave addressed comments unresolved.
5. If intentionally not fixing an issue:

   * explain rationale
   * request reviewer acknowledgement

Example:

```text
Not fixing intentionally.

Reason:
This endpoint is synchronous by design because it executes inside a transaction boundary managed by the framework.
```

---

# AI Remediation Summary

At the end of each review cycle, create a consolidated remediation summary.

Purpose:

* Enables rapid bulk-fix workflows
* Allows direct copy/paste into VSCode Copilot or other AI tooling
* Creates a persistent defect audit trail

---

## Required Format

```text
Review Remediation Summary

Branch:
feature/storage-agent-routing

PR:
#482

Context:
Address all review defects while preserving existing functionality and API contracts.

Defects To Fix:

1. Async Handling
Severity: High
Files:
- services/customer_service.py

Problem:
Repository async calls are not awaited.

Required Fix:
Await all async repository calls and propagate cancellation tokens.

Acceptance Criteria:
- No fire-and-forget database operations
- Unit tests pass
- No lint violations

2. Validation Logic
Severity: Medium
Files:
- api/routes/reservations.py

Problem:
Postal code validation allows invalid formats.

Required Fix:
Add strict ZIP/postal validation before service execution.

Acceptance Criteria:
- Reject malformed postal codes
- Return HTTP 400 with validation message
- Preserve existing API schema

3. Logging
Severity: Low
Files:
- infrastructure/messaging/rabbit_consumer.py

Problem:
Structured logging fields are inconsistent.

Required Fix:
Normalize structured log property names.

Acceptance Criteria:
- Use consistent correlation_id
- Include tenant_id
- Preserve OpenTelemetry tracing
```

---

# Copilot Prompting Guidance

Recommended workflow:

1. Copy the remediation summary.
2. Open affected files in VSCode.
3. Paste into Copilot Chat.
4. Ask Copilot:

```text
Implement all fixes exactly as described.
Do not change unrelated functionality.
Preserve public interfaces and existing behavior.
Generate clean production-ready code.
```

---

# Pull Request Completion Rules

A PR is considered complete only when:

* All review conversations are resolved
* All fixed comments are collapsed
* Remediation summary is added to the PR
* CI/CD passes
* Reviewer approvals are complete
* No unresolved critical/high comments remain

```
```
