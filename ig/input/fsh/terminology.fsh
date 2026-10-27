CodeSystem: QBLayoutBreakpointCS
Id: qb-layout-breakpoint
Title: "Layout breakpoint"
Description: "Container-width breakpoints for the qb 12-column grid. Widths are renderer defaults measured against the renderer's container (CSS container queries), not the viewport."
* ^caseSensitive = true
* ^content = #complete
* #xs "Extra small" "Container narrower than 480px."
* #sm "Small" "Container 480px or wider."
* #md "Medium" "Container 768px or wider."
* #lg "Large" "Container 1024px or wider."
* #xl "Extra large" "Container 1280px or wider."

ValueSet: QBLayoutBreakpointVS
Id: qb-layout-breakpoint
Title: "Layout breakpoint"
Description: "Breakpoints for qb-layout-column and qb-layout-print-breakpoint."
* include codes from system QBLayoutBreakpointCS

CodeSystem: QBRenderChannelCS
Id: qb-render-channel
Title: "Render channel"
Description: "Channels in which a Questionnaire item is presented."
* ^caseSensitive = true
* ^content = #complete
* #web "Web" "Interactive on-screen rendering."
* #pdf "PDF" "Printable (paper) rendering."

ValueSet: QBRenderChannelVS
Id: qb-render-channel
Title: "Render channel"
Description: "Channels for qb-render-channel."
* include codes from system QBRenderChannelCS

CodeSystem: QBPdfAnswerSpaceStyleCS
Id: qb-pdf-answer-space-style
Title: "PDF answer space style"
Description: "How handwriting space is drawn for a question in the PDF."
* ^caseSensitive = true
* ^content = #complete
* #lines "Ruled lines"
* #box "Open box"
* #comb "Character boxes" "One box per character, e.g. NHI numbers or dates."
* #none "No answer space"

ValueSet: QBPdfAnswerSpaceStyleVS
Id: qb-pdf-answer-space-style
Title: "PDF answer space style"
Description: "Answer space styles."
* include codes from system QBPdfAnswerSpaceStyleCS

CodeSystem: QBPdfChoiceStyleCS
Id: qb-pdf-choice-style
Title: "PDF choice style"
Description: "How choice answers print."
* ^caseSensitive = true
* ^content = #complete
* #tickbox "Tick boxes"
* #circle "Circle one"
* #write-in "Write-in line"

ValueSet: QBPdfChoiceStyleVS
Id: qb-pdf-choice-style
Title: "PDF choice style"
Description: "Choice print styles."
* include codes from system QBPdfChoiceStyleCS

CodeSystem: QBPdfPageBreakCS
Id: qb-pdf-page-break
Title: "PDF page break"
Description: "Pagination control for an item in the PDF."
* ^caseSensitive = true
* ^content = #complete
* #before "Page break before"
* #after "Page break after"
* #avoid-inside "Avoid breaking inside"

ValueSet: QBPdfPageBreakVS
Id: qb-pdf-page-break
Title: "PDF page break"
Description: "Page break codes."
* include codes from system QBPdfPageBreakCS
