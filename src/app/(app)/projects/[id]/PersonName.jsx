// A person's name on the project report: a link to their Employee page, or plain text when this
// viewer has none to open (an Admin's page, for anyone but an Admin; `href` is null). Server-safe.
import Link from 'next/link';

/** @param {{ user: { name: string, href?: string | null }, className?: string }} props */
export default function PersonName({ user, className }) {
  if (!user.href) return <span className={className}>{user.name}</span>;
  return (
    <Link href={user.href} className={className}>
      {user.name}
    </Link>
  );
}
