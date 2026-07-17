import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DELAY = 300;

export function useDebouncedFilter(
  key: string,
  urlValue: string,
  setParam: (key: string, value: string) => void,
  { delay = DEFAULT_DELAY } = {},
) {
  const [localValue, setLocalValue] = useState(urlValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(urlValue);
  }, [urlValue]);

  const commit = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setParam(key, localValue);
  }, [key, localValue, setParam]);

  const onChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setParam(key, value);
      }, delay);
    },
    [key, delay, setParam],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { localValue, onChange, commit } as const;
}
