import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  // Themes switch with data-theme on <html>; colours come from CSS variables in globals.css.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--surface-elevated)',
        border: 'var(--border)',
        fg: 'var(--text)',
        'fg-2': 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        accent: 'var(--accent)',
        link: 'var(--link)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
        'accent-soft': 'color-mix(in srgb, var(--accent) 14%, transparent)',
        'success-soft': 'color-mix(in srgb, var(--success) 14%, transparent)',
        'warning-soft': 'color-mix(in srgb, var(--warning) 16%, transparent)',
        'error-soft': 'color-mix(in srgb, var(--error) 14%, transparent)',
        'info-soft': 'color-mix(in srgb, var(--info) 14%, transparent)',
        hover: 'color-mix(in srgb, var(--text) 6%, transparent)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '8px',
        btn: '6px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      maxWidth: {
        content: '760px',
      },
    },
  },
  plugins: [],
};

export default config;
