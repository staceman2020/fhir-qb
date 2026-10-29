import { qbCodeSystem, qbStructureDefinition, qbValueSet } from './canonical.js';

/** qb-* extension ids, as declared by `Id:` in ig/input/fsh. */
export const QB_EXTENSION_IDS = [
  'qb-layout-column',
  'qb-layout-row-break',
  'qb-layout-print-breakpoint',
  'qb-render-channel',
  'qb-pdf-answer-space',
  'qb-pdf-page-break',
  'qb-pdf-blank-repeats',
  'qb-pdf-condition-note',
] as const;

/** qb-* extension URLs (plan §5.3). */
export const QB_EXT = {
  layoutColumn: qbStructureDefinition('qb-layout-column'),
  layoutRowBreak: qbStructureDefinition('qb-layout-row-break'),
  layoutPrintBreakpoint: qbStructureDefinition('qb-layout-print-breakpoint'),
  renderChannel: qbStructureDefinition('qb-render-channel'),
  pdfAnswerSpace: qbStructureDefinition('qb-pdf-answer-space'),
  pdfPageBreak: qbStructureDefinition('qb-pdf-page-break'),
  pdfBlankRepeats: qbStructureDefinition('qb-pdf-blank-repeats'),
  pdfConditionNote: qbStructureDefinition('qb-pdf-condition-note'),
} as const;

export const QB_VALUESET = {
  layoutBreakpoint: qbValueSet('qb-layout-breakpoint'),
  renderChannel: qbValueSet('qb-render-channel'),
  pdfAnswerSpaceStyle: qbValueSet('qb-pdf-answer-space-style'),
  pdfChoiceStyle: qbValueSet('qb-pdf-choice-style'),
  pdfPageBreak: qbValueSet('qb-pdf-page-break'),
} as const;

export const QB_CODESYSTEM = {
  layoutBreakpoint: qbCodeSystem('qb-layout-breakpoint'),
  renderChannel: qbCodeSystem('qb-render-channel'),
  pdfAnswerSpaceStyle: qbCodeSystem('qb-pdf-answer-space-style'),
  pdfChoiceStyle: qbCodeSystem('qb-pdf-choice-style'),
  pdfPageBreak: qbCodeSystem('qb-pdf-page-break'),
} as const;

const HL7 = 'http://hl7.org/fhir/StructureDefinition/';
const SDC = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/';
const R5 = 'http://hl7.org/fhir/5.0/StructureDefinition/';

/** Standard (HL7 core / extensions pack / SDC) extension URLs used by the engine and renderer. */
export const STD_EXT = {
  hidden: `${HL7}questionnaire-hidden`,
  itemControl: `${HL7}questionnaire-itemControl`,
  displayCategory: `${HL7}questionnaire-displayCategory`,
  renderingXhtml: `${HL7}rendering-xhtml`,
  renderingMarkdown: `${HL7}rendering-markdown`,
  renderingStyle: `${HL7}rendering-style`,
  choiceOrientation: `${HL7}questionnaire-choiceOrientation`,
  unit: `${HL7}questionnaire-unit`,
  unitOption: `${HL7}questionnaire-unitOption`,
  minOccurs: `${HL7}questionnaire-minOccurs`,
  maxOccurs: `${HL7}questionnaire-maxOccurs`,
  optionExclusive: `${HL7}questionnaire-optionExclusive`,
  optionPrefix: `${HL7}questionnaire-optionPrefix`,
  supportLink: `${HL7}questionnaire-supportLink`,
  minLength: `${HL7}minLength`,
  maxDecimalPlaces: `${HL7}maxDecimalPlaces`,
  regex: `${HL7}regex`,
  minValue: `${HL7}minValue`,
  maxValue: `${HL7}maxValue`,
  entryFormat: `${HL7}entryFormat`,
  mimeType: `${HL7}mimeType`,
  maxSize: `${HL7}maxSize`,
  ordinalValue: `${HL7}ordinalValue`,
  itemWeight: `${HL7}itemWeight`,
  preferredTerminologyServer: `${HL7}preferredTerminologyServer`,
  shortText: `${SDC}sdc-questionnaire-shortText`,
  unitValueSet: `${HL7}questionnaire-unitValueSet`,
  sliderStepValue: `${HL7}questionnaire-sliderStepValue`,
  collapsible: `${SDC}sdc-questionnaire-collapsible`,
  translation: `${HL7}translation`,
  // Expressions (SDC behaviour, plan §6.4)
  variable: `${HL7}variable`,
  calculatedExpression: `${SDC}sdc-questionnaire-calculatedExpression`,
  initialExpression: `${SDC}sdc-questionnaire-initialExpression`,
  enableWhenExpression: `${SDC}sdc-questionnaire-enableWhenExpression`,
  answerExpression: `${SDC}sdc-questionnaire-answerExpression`,
  answerOptionsToggleExpression: `${SDC}sdc-questionnaire-answerOptionsToggleExpression`,
  candidateExpression: `${SDC}sdc-questionnaire-candidateExpression`,
  launchContext: `${SDC}sdc-questionnaire-launchContext`,
  // Population and extraction (plan §6.5, §6.6)
  itemPopulationContext: `${SDC}sdc-questionnaire-itemPopulationContext`,
  observationLinkPeriod: `${SDC}sdc-questionnaire-observationLinkPeriod`,
  observationExtract: `${SDC}sdc-questionnaire-observationExtract`,
  itemExtractionContext: `${SDC}sdc-questionnaire-itemExtractionContext`,
  definitionExtract: `${SDC}sdc-questionnaire-definitionExtract`,
  templateExtract: `${SDC}sdc-questionnaire-templateExtract`,
  templateExtractContext: `${SDC}sdc-questionnaire-templateExtractContext`,
  templateExtractValue: `${SDC}sdc-questionnaire-templateExtractValue`,
  // Modular forms (plan §6.7)
  subQuestionnaire: `${SDC}sdc-questionnaire-subQuestionnaire`,
  assembleExpectation: `${SDC}sdc-questionnaire-assemble-expectation`,
  linkIdPrefix: `${SDC}sdc-questionnaire-linkIdPrefix`,
  assembledFrom: `${SDC}sdc-questionnaire-assembledFrom`,
  constraint: `${HL7}questionnaire-constraint`,
  /** R5 back-port (plan §3.1). The extensions-pack URL is also accepted. */
  disabledDisplay: `${R5}extension-Questionnaire.item.disabledDisplay`,
  disabledDisplayAlt: `${HL7}questionnaire-disabledDisplay`,
  answerConstraint: `${R5}extension-Questionnaire.item.answerConstraint`,
} as const;

export const ITEM_CONTROL_SYSTEM = 'http://hl7.org/fhir/questionnaire-item-control';
export const DISPLAY_CATEGORY_SYSTEM = 'http://hl7.org/fhir/questionnaire-display-category';
