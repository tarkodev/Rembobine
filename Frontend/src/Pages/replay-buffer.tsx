import { History } from 'lucide-react';
import { getMenuItemLabel } from '../Models/types';
import ContentPage from '../Components/ContentPage';

export default function ReplayBuffer() {
  return (
    <ContentPage
      contentType="Buffer"
      sectionId="replayBuffer"
      title={getMenuItemLabel('Replay Buffer')}
      Icon={History}
    />
  );
}
