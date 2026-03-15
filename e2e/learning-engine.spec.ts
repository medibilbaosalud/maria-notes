import { expect, test } from '@playwright/test';
import {
  shouldMoveCandidateToShadow,
  shouldPromoteShadowToActive,
  shouldBlockActive,
  resolveNextLifecycleState
} from '../src/services/learning/rule-lifecycle';

test.describe('learning engine', () => {
  test('requires more evidence to move clinical rules to shadow', () => {
    expect(shouldMoveCandidateToShadow({
      evidence_count: 2,
      contradiction_count: 0,
      category: 'style'
    })).toBe(true);

    expect(shouldMoveCandidateToShadow({
      evidence_count: 2,
      contradiction_count: 0,
      category: 'clinical'
    })).toBe(false);

    expect(shouldMoveCandidateToShadow({
      evidence_count: 4,
      contradiction_count: 0,
      category: 'clinical'
    })).toBe(true);
  });

  test('blocks critical rules earlier when evaluation deteriorates', () => {
    expect(shouldPromoteShadowToActive({
      edit_rate_delta: -0.03,
      hallucination_delta: 0,
      inconsistency_delta: 0,
      doctor_override_rate: 0.12
    }, 'style')).toBe(true);

    expect(shouldPromoteShadowToActive({
      edit_rate_delta: -0.03,
      hallucination_delta: 0,
      inconsistency_delta: 0,
      doctor_override_rate: 0.12
    }, 'clinical')).toBe(false);

    expect(shouldBlockActive({
      edit_rate_delta: 0,
      hallucination_delta: 0,
      inconsistency_delta: 0,
      doctor_override_rate: 0.4
    }, 'clinical')).toBe(true);
  });

  test('resolveNextLifecycleState keeps clinical rules more conservative end-to-end', () => {
    expect(resolveNextLifecycleState('candidate', {
      evidence_count: 3,
      contradiction_count: 0,
      category: 'clinical'
    })).toBe('candidate');

    expect(resolveNextLifecycleState('candidate', {
      evidence_count: 4,
      contradiction_count: 0,
      category: 'clinical'
    })).toBe('shadow');

    expect(resolveNextLifecycleState('shadow', {
      evidence_count: 4,
      contradiction_count: 0,
      category: 'clinical'
    }, {
      edit_rate_delta: -0.08,
      hallucination_delta: 0,
      inconsistency_delta: 0,
      doctor_override_rate: 0.05
    })).toBe('active');
  });
});
