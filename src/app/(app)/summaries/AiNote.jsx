// "Written by AI from Daybook's data. Check anything important." under every summary (CONTRACT 20).
import { Sparkles } from 'lucide-react';
import { aiSummaries } from '@/modules/aiSummaries';
import styles from './AiNote.module.css';

export default function AiNote({ className }) {
  return (
    <p className={[styles.note, className].filter(Boolean).join(' ')}>
      <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" className={styles.icon} />
      <span>{aiSummaries.AI_NOTE}</span>
    </p>
  );
}
