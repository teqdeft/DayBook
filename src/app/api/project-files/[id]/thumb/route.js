// A picture's thumbnail (CONTRACT 27, Downloads): GET → the small JPEG the uploader's browser made
// (`files/<storage_key>.t`), inline `image/jpeg`, after the same file rule as the download; 404
// without a thumbnail. One bucket of 600 a minute per person with the download and the view.
import { withRoute } from '@/lib/route';
import { answerFile } from '../../fileRoute';

export const runtime = 'nodejs';

export const GET = withRoute({ permission: 'signed_in' }, (context) =>
  answerFile(context, 'thumb'),
);
