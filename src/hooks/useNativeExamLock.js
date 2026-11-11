import { useCallback, useEffect, useRef, useState } from 'react';
import { enterExamMode, exitExamMode, isNative, watchExamMode } from '../native';

/**
 * Android app only: while `active` (an exam attempt is in progress) the app is full screen and pinned
 * (see native/android/ExamLockPlugin.java). `lost` turns true when the student un-pins the screen;
 * call `reenter()` (from a tap) to switch it back on. In a normal browser this does nothing (lost stays false).
 */
export default function useNativeExamLock({ active, onLost }) {
  const [lost, setLost] = useState(false);
  const onLostRef = useRef(onLost);
  const stopRef = useRef(null);
  useEffect(() => { onLostRef.current = onLost; }, [onLost]);

  const start = useCallback(async () => {
    stopRef.current?.();
    stopRef.current = null;
    await enterExamMode();
    setLost(false);
    stopRef.current = watchExamMode(() => { setLost(true); onLostRef.current?.(); });
  }, []);

  useEffect(() => {
    if (!isNative || !active) return undefined;
    let dead = false;
    start().then(() => { if (dead) { stopRef.current?.(); stopRef.current = null; } });
    return () => {
      dead = true;
      stopRef.current?.();
      stopRef.current = null;
      exitExamMode();
    };
  }, [active, start]);

  return { lost: isNative && lost, reenter: start };
}
