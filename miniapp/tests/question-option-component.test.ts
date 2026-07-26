import { afterEach, describe, expect, it, vi } from 'vitest';

interface AnimationData {
  keyPopActive: boolean;
}

interface ObserverContext {
  data: AnimationData;
  setData(updates: Partial<AnimationData>, callback?: () => void): void;
}

interface QuestionOptionComponentDefinition {
  properties: {
    selected: {
      observer?: (this: ObserverContext, selected: boolean, previous: boolean) => void;
    };
  };
  observers?: Record<string, unknown>;
}

const loadQuestionOptionDefinition = async (): Promise<QuestionOptionComponentDefinition> => {
  let captured: QuestionOptionComponentDefinition | undefined;
  vi.stubGlobal('Component', (definition: QuestionOptionComponentDefinition) => {
    captured = definition;
  });
  vi.resetModules();

  await import('../miniprogram/components/question-option/index');

  if (!captured) throw new Error('question-option component was not registered');
  return captured;
};

const makeObserverContext = (): ObserverContext => {
  const data: AnimationData = { keyPopActive: false };
  return {
    data,
    setData(updates, callback) {
      Object.assign(data, updates);
      callback?.();
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('question-option selected observer contract', () => {
  it('uses the selected property observer that receives the previous value', async () => {
    const definition = await loadQuestionOptionDefinition();

    expect(definition.properties.selected.observer).toBeTypeOf('function');
    expect(definition.observers?.['selected']).toBeUndefined();
  });

  it('animates only false-to-true and ignores stale 300ms cleanup', async () => {
    vi.useFakeTimers();
    const definition = await loadQuestionOptionDefinition();
    const observer = definition.properties.selected.observer;
    if (!observer) throw new Error('selected property observer is missing');
    const context = makeObserverContext();

    observer.call(context, true, true);
    expect(context.data.keyPopActive).toBe(false);

    observer.call(context, true, false);
    expect(context.data.keyPopActive).toBe(true);

    vi.advanceTimersByTime(100);
    observer.call(context, false, true);
    expect(context.data.keyPopActive).toBe(false);

    observer.call(context, true, false);
    vi.advanceTimersByTime(200);
    expect(context.data.keyPopActive).toBe(true);

    vi.advanceTimersByTime(100);
    expect(context.data.keyPopActive).toBe(false);
  });
});
