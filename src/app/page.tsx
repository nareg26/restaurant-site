import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Staff Tools</h1>
        <p>Internal tools for running the restaurant.</p>
        <ul>
          <li>
            <Link href="/staff/schedule">📅 Weekly shift schedule</Link>
          </li>
          <li>
            <Link href="/staff/preferences">🗳️ Open-shift preferences</Link>
          </li>
          <li>
            <Link href="/staff/tasks">📋 Tasks</Link>
          </li>
        </ul>
      </main>
    </div>
  );
}
