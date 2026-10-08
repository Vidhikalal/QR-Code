import styles from './badge.module.css';

export default function BadgeNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Not a Passline badge</h1>
        <p className={styles.muted}>This link doesn’t match any badge. Check you tapped the right one.</p>
      </div>
    </main>
  );
}
