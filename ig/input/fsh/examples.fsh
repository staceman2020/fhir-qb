Instance: QBExampleLayout
InstanceOf: QBQuestionnaire
Usage: #example
Title: "Example: two-column name fields"
Description: "Given and family name side by side from md upwards; full width on small containers."
* status = #draft
* title = "Contact details"
* item[0].linkId = "given-name"
* item[0].type = #string
* item[0].text = "Given name"
* item[0].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-layout-column"
* item[0].extension[0].extension[0].url = "breakpoint"
* item[0].extension[0].extension[0].valueCode = #md
* item[0].extension[0].extension[1].url = "span"
* item[0].extension[0].extension[1].valuePositiveInt = 6
* item[1].linkId = "family-name"
* item[1].type = #string
* item[1].text = "Family name"
* item[1].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-layout-column"
* item[1].extension[0].extension[0].url = "breakpoint"
* item[1].extension[0].extension[0].valueCode = #md
* item[1].extension[0].extension[1].url = "span"
* item[1].extension[0].extension[1].valuePositiveInt = 6
* item[2].linkId = "email"
* item[2].type = #string
* item[2].text = "Email"
* item[2].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-layout-row-break"
* item[2].extension[0].valueBoolean = true

Instance: QBExampleChannel
InstanceOf: QBQuestionnaire
Usage: #example
Title: "Example: PDF-only and web-only content"
Description: "A PDF-only instruction (also hidden for standard renderers) and web-only help."
* status = #draft
* title = "Channel content"
* item[0].linkId = "pdf-instructions"
* item[0].type = #display
* item[0].text = "Use black ink and write in CAPITAL LETTERS."
* item[0].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-render-channel"
* item[0].extension[0].valueCode = #pdf
* item[0].extension[1].url = $hidden
* item[0].extension[1].valueBoolean = true
* item[0].extension[2].url = $displayCategory
* item[0].extension[2].valueCodeableConcept = http://hl7.org/fhir/questionnaire-display-category#instructions
* item[1].linkId = "web-help"
* item[1].type = #display
* item[1].text = "Your answers are saved as you type."
* item[1].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-render-channel"
* item[1].extension[0].valueCode = #web
* item[2].linkId = "nhi"
* item[2].type = #string
* item[2].text = "NHI number"
* item[2].extension[0].url = "http://example.org/fhir/qb/StructureDefinition/qb-pdf-answer-space"
* item[2].extension[0].extension[0].url = "style"
* item[2].extension[0].extension[0].valueCode = #comb
* item[2].extension[0].extension[1].url = "combCount"
* item[2].extension[0].extension[1].valuePositiveInt = 7
