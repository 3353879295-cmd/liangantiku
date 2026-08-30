const ICON_GLYPHS: Record<string, string> = {
  assignment: '▤',
  'book-open': '▰',
  'chart-bar': '▥',
  chat: '◌',
  check: '✓',
  'check-circle': '✓',
  'check-circle-filled': '●',
  'chevron-down': '⌄',
  'chevron-left': '‹',
  'chevron-right': '›',
  'chevron-up': '⌃',
  circle: '○',
  close: '×',
  'close-circle-filled': '●',
  'cloud-upload': '☁',
  delete: '⌫',
  'error-circle': '!',
  home: '⌂',
  'info-circle': 'i',
  'lock-on': '⌑',
  setting: '⚙',
  star: '☆',
  'star-filled': '★',
  swap: '↔',
  tools: '⚒',
  user: '◉',
};

const iconStyle = (size: string, color: string): string => {
  const declarations = [`font-size: ${size || '32rpx'}`];
  if (color) declarations.push(`color: ${color}`);
  return declarations.join('; ');
};

Component({
  options: {
    styleIsolation: 'apply-shared',
    virtualHost: true,
  },
  properties: {
    name: { type: String, value: '' },
    size: { type: String, value: '32rpx' },
    color: { type: String, value: '' },
  },
  data: {
    glyph: '',
    loading: false,
    styleText: iconStyle('32rpx', ''),
  },
  observers: {
    'name, size, color'(name: string, size: string, color: string) {
      this.setData({
        glyph: ICON_GLYPHS[name] ?? '•',
        loading: name === 'loading',
        styleText: iconStyle(size, color),
      });
    },
  },
});
