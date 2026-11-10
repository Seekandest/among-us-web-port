import styles from './Button.module.css';

export function Button({ onClick, children, className = "", disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${styles.button} ${className}`}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      {children}
    </button>
  );
}

export default Button;
