import { itemSchema, type Item, type ItemOf, type TypeId } from '@/content/schemas';

/** A schema-valid item for unit tests, with the build's own field names. */
export function makeItem<T extends TypeId>(
  type_id: T,
  prompt: unknown,
  answer: unknown,
  extra: Partial<Record<'id' | 'targets' | 'constraints' | 'feedback' | 'say' | 'unit' | 'node', unknown>> = {},
): ItemOf<T> {
  return itemSchema.parse({
    id: 'item.test',
    node: 'S01U01N1',
    unit: 'S01U01',
    tier: 1,
    instruction_key: `instr.${type_id}`,
    targets: {},
    constraints: {},
    feedback: {},
    say: null,
    type_id,
    prompt,
    answer,
    ...extra,
  }) as ItemOf<T>;
}

export type { Item };
