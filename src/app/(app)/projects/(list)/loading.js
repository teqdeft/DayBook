// Shown while /projects loads, before the page knows which view the person gets. The page then
// shows the skeleton of its own view (card grid or table) while its data loads. Only the list's:
// in the (list) group it never wraps /projects/[id] (see that segment's layout.js).
import { MyProjectsSkeleton } from '../ProjectsSkeletons';

export default function Loading() {
  return <MyProjectsSkeleton />;
}
