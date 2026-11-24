// A picture shown inside Daybook (CONTRACT 27, Downloads): GET → a magic-checked PNG, JPEG, GIF or
// WebP of at most 40 megapixels, inline with its own type, after the same file rule as the
// download (404 "We couldn't find that file." to anyone who may not see it); any other file 404
// "This file can't be shown here. Download it instead.". One bucket of 600 a minute per person
// with the download and the thumbnail.
import { withRoute } from '@/lib/route';
import { answerFile } from '../../fileRoute';

export const runtime = 'nodejs';

export const GET = withRoute({ permission: 'signed_in' }, (context) => answerFile(context, 'view'));
