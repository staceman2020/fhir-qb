Profile: QBQuestionnaire
Parent: $SDCQuestionnaire
Id: qb-questionnaire
Title: "qb Questionnaire"
Description: "SDC Base Questionnaire that may use the qb layout, channel and PDF extensions."
* extension contains QBLayoutPrintBreakpoint named printBreakpoint 0..1
* obeys qb-chan-1 and qb-col-3

Invariant: qb-chan-1
Description: "A required item cannot be PDF-only (the web response would be unsubmittable)"
Expression: "repeat(item).where(extension.where(url = 'http://example.org/fhir/qb/StructureDefinition/qb-render-channel').value = 'pdf').all(required.empty() or required = false)"
Severity: #error

Invariant: qb-col-3
Description: "At most one qb-layout-column per breakpoint on an item"
Expression: "repeat(item).all(extension.where(url = 'http://example.org/fhir/qb/StructureDefinition/qb-layout-column').extension.where(url = 'breakpoint').value.isDistinct())"
Severity: #error
