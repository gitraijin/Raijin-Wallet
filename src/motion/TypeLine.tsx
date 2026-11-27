import { useEffect, useState } from 'react';
import type { TextProps } from 'react-native';

import { Mono } from '@/components/ui';

import { useMotion } from './index';

const CHAR_MS = 22;

/** Text that types itself out like a terminal; static with reduced motion. */
export function TypeLine({ text, style, ...props }: TextProps & { text: string }) {
  const motion = useMotion();
  const [shown, setShown] = useState(motion ? 0 : text.length);

  useEffect(() => {
    if (!motion) return;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(timer);
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [text, motion]);

  const visible = motion ? text.slice(0, shown) : text;
  return (
    <Mono {...props} style={style} accessibilityLabel={text}>
      {visible}
      {motion && shown < text.length ? '▌' : ''}
    </Mono>
  );
}
