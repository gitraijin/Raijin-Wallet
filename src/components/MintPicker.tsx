import { useCashu } from '@/cashu/CashuContext';
import { Chips, Label } from '@/components/ui';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useAmount } from '@/preferences/useAmount';

/** Mint selection for the cashu screens; hidden with only one mint. */
export function MintPicker() {
  const { t } = usePreferences();
  const amount = useAmount();
  const { mints, balances, selectedMint, selectMint } = useCashu();
  if (mints.length < 2 || !selectedMint) return null;
  return (
    <>
      <Label>{t('cashu.mint')}</Label>
      <Chips
        options={mints.map((m) => ({ value: m.id, label: `${m.name} · ${amount.format(balances[m.id] ?? 0n)}` }))}
        value={selectedMint.id}
        onChange={selectMint}
      />
    </>
  );
}
