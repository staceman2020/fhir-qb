/**
 * Placeholder canonical base for the qb Implementation Guide (plan §1.1, §5.2, open decision #1).
 * Must match `canonical` in ig/sushi-config.yaml — asserted by canonical.test.ts.
 */
export const QB_CANONICAL = 'http://example.org/fhir/qb';

export const qbStructureDefinition = (id: string): string =>
  `${QB_CANONICAL}/StructureDefinition/${id}`;
export const qbValueSet = (id: string): string => `${QB_CANONICAL}/ValueSet/${id}`;
export const qbCodeSystem = (id: string): string => `${QB_CANONICAL}/CodeSystem/${id}`;
