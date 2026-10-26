// Ask Daybook while it loads: the top bar, the chat card (empty thread over the question box)
// and the side column's two cards.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import chat from './AskChat.module.css';
import page from './page.module.css';
import styles from './loading.module.css';

export default function AskLoading() {
  return (
    <div className={page.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading Ask Daybook</span>
      <div className={styles.heading}>
        <Skeleton width={190} height={30} radius={8} />
        <Skeleton width={340} height={16} />
      </div>
      <div className={chat.layout}>
        <Card padding="none" className={chat.chat}>
          <div className={styles.thread}>
            <Skeleton width={44} height={44} radius={22} />
            <Skeleton width={260} height={18} />
            <Skeleton width={340} height={14} />
          </div>
          <div className={chat.composer}>
            <Skeleton height={68} radius={10} />
            <div className={styles.foot}>
              <Skeleton width="55%" height={14} />
              <Skeleton width={88} height={44} radius={10} />
            </div>
          </div>
        </Card>
        <div className={chat.side}>
          <Card>
            <Skeleton width={110} height={20} />
            <div className={styles.examples}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={44} radius={10} />
              ))}
            </div>
          </Card>
          <Card>
            <Skeleton width={190} height={20} />
            <div className={styles.examples}>
              <Skeleton height={14} />
              <Skeleton width="80%" height={14} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
