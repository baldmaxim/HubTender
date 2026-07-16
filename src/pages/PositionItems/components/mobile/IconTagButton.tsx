import { theme } from 'antd';

interface IconTagButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  /** Читается скринридером и всплывает подсказкой. */
  label: string;
  disabled?: boolean;
  /** Акцентный (✓ «Сохранить») против нейтрального (✎ / ✕). */
  tone?: 'neutral' | 'primary';
}

/**
 * Маленькая кнопка-ярлык: глиф 14px в чипе 24×24, но РЕАЛЬНАЯ зона нажатия —
 * 44×44 через hit-slop (padding 10 + отрицательный margin), поэтому вид остаётся
 * «ярлыком», а палец попадает. Лэйаут по-прежнему занимает 24px.
 */
const IconTagButton: React.FC<IconTagButtonProps> = ({
  icon,
  onClick,
  label,
  disabled = false,
  tone = 'neutral',
}) => {
  const { token } = theme.useToken();
  const accent = tone === 'primary' ? token.colorPrimary : token.colorTextSecondary;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        // Хитбокс 44×44 (24 + 10*2), визуально — 24×24.
        padding: 10,
        margin: -10,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        lineHeight: 0,
        flex: '0 0 auto',
        // Убирает 300мс задержку и double-tap-zoom на мобильных.
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 6,
          fontSize: 14,
          color: accent,
          background: tone === 'primary' ? token.colorPrimaryBg : token.colorFillTertiary,
        }}
      >
        {icon}
      </span>
    </button>
  );
};

export default IconTagButton;
