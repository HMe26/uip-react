import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import Messages from './Messages';
import MessagesCenter, { isCenterSection } from './MessagesCenter';

const ChatSettings = lazy(() => import('./ChatSettings'));

/**
 * /{portal}/messages/:conversationId — a chat id opens the messenger; archived|blocked|reports|trash open the full pages;
 * `settings` opens the chat settings page (privacy, bio, backgrounds, notifications).
 */
export default function MessagesRoute() {
  const { conversationId } = useParams();
  if (conversationId === 'settings') {
    return <Suspense fallback={null}><ChatSettings key="settings" /></Suspense>;
  }
  return isCenterSection(conversationId) ? <MessagesCenter key={conversationId} section={conversationId} /> : <Messages />;
}
