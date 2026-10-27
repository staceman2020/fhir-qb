import type { QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension } from '@qb/extensions';
import { ItemText } from './ItemText.js';

export function displayCategory(item: QuestionnaireItem): string | undefined {
  return getExtension(item, STD_EXT.displayCategory)?.valueCodeableConcept?.coding?.[0]?.code;
}

export function DisplayView({ item }: { item: QuestionnaireItem }) {
  const cls =
    displayCategory(item) === 'instructions' ? 'qb-display qb-instructions' : 'qb-display';
  return (
    <div className={cls} part="display">
      <ItemText item={item} />
    </div>
  );
}
