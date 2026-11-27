import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, shape, space, type ThemeColors, useTheme } from '@/theme';

import { BrandMark } from './BrandMark';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* The app draws edge-to-edge, so Android no longer shrinks the window for
          the keyboard: make room ourselves, or the keyboard covers the inputs. */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.fill]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Header: terminal style "< RAIJIN://SEND", Fujin style "‹ [oni] Send". */
export function Header({ title, back = true }: { title: string; back?: boolean }) {
  const styles = useStyles();
  const { colors, uiStyle } = useTheme();
  const t = useT();
  const fujin = uiStyle === 'fujin';
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel={t('common.back')}>
          <Mono style={styles.headerBack}>{fujin ? '‹' : '<'}</Mono>
        </Pressable>
      ) : null}
      {fujin ? (
        <>
          <BrandMark size={30} />
          <Mono style={styles.headerTitleFujin} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {title}
          </Mono>
        </>
      ) : (
        <Mono style={styles.headerTitle}>
          <Mono style={{ color: colors.textDim }}>RAIJIN://</Mono>
          {title.toUpperCase()}
        </Mono>
      )}
    </View>
  );
}

/** Bordered box with a small "// LABEL" caption. */
export function Panel({
  label,
  children,
  accent,
  style,
  right,
  collapsible = false,
  defaultOpen = true,
}: {
  label?: string;
  children: ReactNode;
  accent?: string;
  style?: ViewStyle;
  /** Shown at the end of the label row, e.g. a small toggle. */
  right?: ReactNode;
  /** Fujin style only: the caption opens and closes the panel. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const styles = useStyles();
  const { colors, uiStyle } = useTheme();
  // Opened in terminal style (all open) and switched to Fujin: stay open, do not snap shut.
  const [open, setOpen] = useState(defaultOpen || uiStyle !== 'fujin');
  const fujin = uiStyle === 'fujin';
  const folds = collapsible && fujin;
  const head =
    label || right ? (
      <View style={styles.panelHead}>
        <Label style={styles.panelLabel}>{label ? (fujin ? label : `// ${label}`) : ''}</Label>
        {right}
        {folds ? <Mono style={styles.chevron}>{open ? '⌄' : '›'}</Mono> : null}
      </View>
    ) : null;
  return (
    <View style={[styles.panel, { borderColor: accent ?? colors.border }, style]}>
      {folds ? (
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6}>
          {head}
        </Pressable>
      ) : (
        head
      )}
      {!folds || open ? children : null}
    </View>
  );
}

/** "LABEL ........ value" line inside panels. */
export function InfoRow({
  k,
  v,
  strong = false,
  onPress,
}: {
  k: string;
  v: string;
  strong?: boolean;
  /** Makes the value tappable, e.g. to copy it. */
  onPress?: () => void;
}) {
  const styles = useStyles();
  const value = <Mono style={[styles.infoValue, strong && styles.infoStrong]}>{v}</Mono>;
  return (
    <View style={styles.infoRow}>
      <Label>{k}</Label>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={8} style={styles.infoPress}>
          {value}
        </Pressable>
      ) : (
        value
      )}
    </View>
  );
}

export function Spacer({ size = space.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function Mono({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text {...props} style={[styles.mono, style, tallDigits(style)]} />;
}

/**
 * Manrope (Fujin style) has taller digits than JetBrains Mono. Large numbers
 * without an explicit lineHeight get their tops cut, so give them room.
 */
function tallDigits(style: TextProps['style']) {
  if (shape.radius === 0) return null;
  const flat = StyleSheet.flatten(style);
  const size = flat?.fontSize;
  if (!size || size < 20 || flat.lineHeight) return null;
  return { lineHeight: Math.round(size * 1.32), paddingTop: 2 };
}

export function Label({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text {...props} style={[styles.label, style]} />;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const styles = useStyles();
  if (!children) return null;
  return <Mono style={styles.error}>{`! ${String(children)}`}</Mono>;
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const styles = useStyles();
  const { colors, uiStyle } = useTheme();
  const palette = buttonPalette(colors)[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.buttonPressed,
        inactive && styles.buttonDisabled,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        // One line always: long labels in half-width buttons ("[ UMBENENNEN ]",
        // "[ ENREGISTRER ]") shrink a little instead of wrapping.
        <Mono
          style={[styles.buttonLabel, { color: palette.fg }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}>{uiStyle === 'fujin' ? label : `[ ${label.toUpperCase()} ]`}</Mono>
      )}
    </Pressable>
  );
}

function buttonPalette(
  colors: ThemeColors,
): Record<ButtonVariant, { bg: string; fg: string; border: string }> {
  return {
    primary: {
      bg: colors.primary,
      fg: colors.onPrimary,
      border: colors.primary,
    },
    secondary: { bg: 'transparent', fg: colors.accent, border: colors.accent },
    ghost: { bg: 'transparent', fg: colors.text, border: colors.borderStrong },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  };
}

export function Input({ style, ...props }: TextInputProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      selectionColor={colors.primary}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, props.multiline && styles.inputMultiline, style]}
    />
  );
}

/** Row of mutually exclusive options, e.g. "LIGHTNING | ON-CHAIN". */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  const { colors, uiStyle } = useTheme();
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}>
            <Mono style={[styles.segmentLabel, active && { color: uiStyle === 'fujin' ? colors.onPrimary : colors.accent }]}>
              {uiStyle === 'fujin' ? option.label : option.label.toUpperCase()}
            </Mono>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Wrapping set of small selectable boxes, for longer option lists. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}>
            <Mono style={[styles.chipLabel, active && styles.chipLabelActive]}>{option.label}</Mono>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles((colors) => {
  // Re-run per UI style: `fonts` and `shape` hold the values of the active one.
  const fujin = shape.radius > 0;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: space.md, gap: space.md },
    fill: { flex: 1 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: fujin ? 10 : space.md,
      paddingVertical: space.sm,
    },
    headerBack: { fontSize: fujin ? 30 : 20, lineHeight: fujin ? 32 : undefined, color: colors.primary, fontFamily: fonts.bold },
    headerTitle: { fontSize: 14, letterSpacing: 2, fontFamily: fonts.bold },
    headerTitleFujin: { flex: 1, fontSize: 22, fontFamily: fonts.bold, color: colors.text },

    panel: {
      borderWidth: 1,
      borderRadius: shape.radius,
      backgroundColor: colors.surface,
      padding: space.md,
      gap: space.sm,
    },
    panelHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: space.xs,
    },
    panelLabel: { flexShrink: 1 },
    chevron: { fontSize: 22, lineHeight: 24, color: colors.textDim, marginLeft: 'auto', paddingLeft: space.sm },
    infoRow: {
      flexDirection: 'row',
      flexWrap: fujin ? 'wrap' : 'nowrap',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: space.md,
    },
    infoPress: { flexShrink: 1 },
    infoValue: { flexShrink: 1, textAlign: 'right', fontSize: fujin ? 14 : 13 },
    infoStrong: { fontFamily: fonts.bold, color: colors.primary, fontSize: fujin ? 16 : 15 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: shape.pill,
      paddingVertical: 8,
      paddingHorizontal: fujin ? 14 : 12,
    },
    chipActive: { borderColor: colors.accent },
    chipLabel: { fontFamily: fonts.medium, fontSize: fujin ? 14 : 12, color: colors.textDim },
    chipLabelActive: { color: colors.accent },

    mono: { fontFamily: fonts.regular, color: colors.text, fontSize: fujin ? 15 : 14, lineHeight: fujin ? 21 : undefined },
    label: {
      fontFamily: fujin ? fonts.bold : fonts.medium,
      color: colors.textDim,
      fontSize: fujin ? 12 : 11,
      letterSpacing: fujin ? 1.2 : 1.5,
      textTransform: 'uppercase',
    },
    error: { color: colors.danger, fontSize: fujin ? 14 : 13 },

    button: {
      borderWidth: fujin ? 1.5 : 1,
      borderRadius: shape.radius,
      paddingVertical: fujin ? 12 : 14,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
    },
    buttonPressed: { opacity: 0.7 },
    buttonDisabled: { opacity: 0.35 },
    // textAlign: with adjustsFontSizeToFit the label spans the whole button on Android.
    buttonLabel: { fontFamily: fonts.bold, fontSize: fujin ? 16 : 13, letterSpacing: fujin ? 0 : 2, textAlign: 'center' },

    input: {
      fontFamily: fonts.regular,
      fontSize: fujin ? 16 : 14,
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: fujin ? 12 : 0,
      paddingHorizontal: space.md,
      paddingVertical: 12,
    },
    inputMultiline: { minHeight: 110, textAlignVertical: 'top' },

    segmented: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: shape.radius,
      overflow: 'hidden',
    },
    segment: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segmentActive: fujin
      ? { backgroundColor: colors.primary }
      : { backgroundColor: colors.surface, borderBottomWidth: 2, borderBottomColor: colors.accent },
    segmentLabel: {
      fontFamily: fujin ? fonts.bold : fonts.medium,
      fontSize: fujin ? 14 : 12,
      letterSpacing: fujin ? 0 : 1.5,
      color: colors.textDim,
    },
  });
});
