// ---------------------------------------------------------------- layout (plan §5.3 A–C)

Extension: QBLayoutColumn
Id: qb-layout-column
Title: "Layout column (12-column grid)"
Description: "Responsive placement of a Questionnaire item within its parent's 12-column grid. Mobile-first: an entry applies from its breakpoint upwards until overridden. No xs entry means full width at xs."
Context: Questionnaire.item
* extension contains breakpoint 1..1 and span 1..1 and offset 0..1
* extension[breakpoint].value[x] only code
* extension[breakpoint].valueCode from QBLayoutBreakpointVS (required)
* extension[span].value[x] only positiveInt
* extension[offset].value[x] only unsignedInt
* obeys qb-col-1 and qb-col-2

Invariant: qb-col-1
Description: "span must be 1..12"
Expression: "extension.where(url='span').value <= 12"
Severity: #error

Invariant: qb-col-2
Description: "offset + span must not exceed 12"
Expression: "iif(extension.where(url='offset').exists(), extension.where(url='offset').value, 0) + extension.where(url='span').value <= 12"
Severity: #error

Extension: QBLayoutRowBreak
Id: qb-layout-row-break
Title: "Layout row break"
Description: "The item starts a new grid row regardless of remaining space."
Context: Questionnaire.item
* value[x] only boolean

Extension: QBLayoutPrintBreakpoint
Id: qb-layout-print-breakpoint
Title: "Layout print breakpoint"
Description: "Which breakpoint's layout the PDF converter uses. Default md."
Context: Questionnaire
* value[x] only code
* valueCode from QBLayoutBreakpointVS (required)

// ---------------------------------------------------------------- channel (plan §5.3 D)

Extension: QBRenderChannel
Id: qb-render-channel
Title: "Render channel"
Description: "Restricts an item to one channel. Absent means both. PDF-only items SHALL also carry questionnaire-hidden = true so renderers unaware of this extension do not show them (ADR-007); renderers that understand this extension treat it as authoritative over questionnaire-hidden."
Context: Questionnaire.item
* value[x] only code
* valueCode from QBRenderChannelVS (required)

// ---------------------------------------------------------------- PDF (plan §5.3 E–H)

Extension: QBPdfAnswerSpace
Id: qb-pdf-answer-space
Title: "PDF answer space"
Description: "Handwriting space hints for a question in the PDF. Defaults when absent are driven by item type."
Context: Questionnaire.item
* extension contains style 0..1 and lines 0..1 and height 0..1 and combCount 0..1 and choiceStyle 0..1
* extension[style].value[x] only code
* extension[style].valueCode from QBPdfAnswerSpaceStyleVS (required)
* extension[lines].value[x] only positiveInt
* extension[height].value[x] only Quantity
* extension[height].valueQuantity.system = $UCUM
* extension[height].valueQuantity.code = #mm
* extension[combCount].value[x] only positiveInt
* extension[choiceStyle].value[x] only code
* extension[choiceStyle].valueCode from QBPdfChoiceStyleVS (required)

Extension: QBPdfPageBreak
Id: qb-pdf-page-break
Title: "PDF page break"
Description: "Pagination control for the item in the PDF."
Context: Questionnaire.item
* value[x] only code
* valueCode from QBPdfPageBreakVS (required)

Extension: QBPdfBlankRepeats
Id: qb-pdf-blank-repeats
Title: "PDF blank repeats"
Description: "Number of blank instances printed for a repeating item."
Context: Questionnaire.item
* value[x] only positiveInt

Extension: QBPdfConditionNote
Id: qb-pdf-condition-note
Title: "PDF condition note"
Description: "Paper rendering of skip logic. valueMarkdown overrides the auto-generated note; valueBoolean = false suppresses it."
Context: Questionnaire.item
* value[x] only markdown or boolean
* obeys qb-cond-1

Invariant: qb-cond-1
Description: "A boolean condition note may only be false (true has no meaning)"
Expression: "value.ofType(boolean).exists() implies value.ofType(boolean) = false"
Severity: #error
