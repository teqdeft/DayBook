// Shown while /projects loads, before the page knows which view the person gets. The page then
// shows the skeleton of its own view (card grid or table) while its data loads.
import { MyProjectsSkeleton } from './ProjectsSkeletons';

export default function Loading() {
  return <MyProjectsSkeleton />;
}
