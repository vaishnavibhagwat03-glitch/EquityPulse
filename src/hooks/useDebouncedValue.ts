'use client';

import { useEffect, useState } from 'react';

/** Value that settles `ms` after its last change (e.g. arrowing through rows). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
