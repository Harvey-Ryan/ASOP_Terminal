import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EventCreateForm } from './EventCreateForm';

export function EventCreatePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <Card>
        <CardHeader>
          <CardTitle>Create Event</CardTitle>
        </CardHeader>
        <CardContent>
          <EventCreateForm
            guildId={guildId!}
            onSuccess={() => navigate(`/dashboard/servers/${guildId}`)}
            onCancel={() => navigate(-1)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
