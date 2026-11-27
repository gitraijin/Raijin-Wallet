import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, type TextStyle, View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { Mono } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, useTheme } from '@/theme';

/** Blinking terminal cursor. */
export function Cursor({ color }: { color?: string }) {
  const { colors, uiStyle } = useTheme();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (uiStyle === 'fujin') return;
    const id = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [uiStyle]);
  // A terminal detail: the Fujin style has no cursor.
  if (uiStyle === 'fujin') return null;
  return <Mono style={{ color: color ?? colors.primary, opacity: visible ? 1 : 0 }}>_</Mono>;
}

const WORDS = ['RAIJIN', 'BITCOIN', 'WALLET'];
const GLYPHS = 'ϟ₿#$%&*<>/\\|=+@§';
/** How long each word stays: RAIJIN long, the others briefly. */
const HOLD_MS = [14_000, 4_500, 4_500];
const FRAME_MS = 85;
const FRAMES = 20;

type Char = { ch: string; settled: boolean };

const settled = (word: string): Char[] => [...word].map((ch) => ({ ch, settled: true }));
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

/** One frame of the decode effect from `from` to `to` at progress 0..1. */
function scramble(from: string, to: string, progress: number): Char[] {
  const length = Math.round(from.length + (to.length - from.length) * progress);
  const resolved = Math.floor(progress * length);
  return Array.from({ length }, (_, i) =>
    i < resolved ? { ch: to[i] ?? ' ', settled: true } : { ch: glyph(), settled: false },
  );
}

/**
 * "RAIJIN" that decodes through symbols into "BITCOIN", then "WALLET", and
 * back. Static when the system asks to reduce motion.
 */
export function AnimatedWordmark({ style }: { style?: TextStyle }) {
  const { colors } = useTheme();
  const [chars, setChars] = useState<Char[]>(() => settled(WORDS[0]));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;

    const run = async () => {
      if (await AccessibilityInfo.isReduceMotionEnabled().catch(() => false)) return;
      const next = () => {
        if (cancelled) return;
        const from = WORDS[index];
        index = (index + 1) % WORDS.length;
        const to = WORDS[index];
        let frame = 0;
        const step = () => {
          if (cancelled) return;
          frame += 1;
          if (frame >= FRAMES) {
            setChars(settled(to));
            timer = setTimeout(next, HOLD_MS[index]);
            return;
          }
          setChars(scramble(from, to, frame / FRAMES));
          timer = setTimeout(step, FRAME_MS);
        };
        step();
      };
      timer = setTimeout(next, HOLD_MS[0]);
    };
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <Mono style={style} accessibilityLabel="Raijin" accessibilityRole="header">
      {chars.map((c, i) => (
        <Mono key={i} style={[style, !c.settled && { color: colors.accent }]}>
          {c.ch}
        </Mono>
      ))}
    </Mono>
  );
}

/** Logo: [ϟ] mark, animated wordmark and a terminal-style tagline. */
export function Logo({ tagline = true }: { tagline?: boolean }) {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <BrandMark size={56} />
        <AnimatedWordmark style={styles.wordmark} />
      </View>
      {tagline ? (
        <Mono style={styles.tagline}>
          {t('brand.tagline')}
          <Cursor />
        </Mono>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    wordmark: {
      fontFamily: fonts.bold,
      fontSize: 36,
      letterSpacing: 8,
      color: colors.primary,
    },
    tagline: { color: colors.textDim, fontSize: 12 },
  }),
);
