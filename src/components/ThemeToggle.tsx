import { toggleTheme, useAppTheme } from '../lib/theme';
import { cx } from '../lib/util';
import { IconMoon, IconSun } from './icons';

/** Light ↔ dark. Until you use it, ReadX follows your device's setting. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useAppTheme().resolved === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button className={cx('icon-btn', className)} onClick={toggleTheme} aria-label={label} title={label}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
