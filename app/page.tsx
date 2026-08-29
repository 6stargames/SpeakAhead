import { ClientOnlyAac } from './client-only-aac';
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from './chatgpt-auth';

export default async function Home() {
  const user = await getChatGPTUser();
  const identity = user
    ? {
        displayName: user.displayName,
        email: user.email,
        signOutPath: chatGPTSignOutPath('/'),
      }
    : {
        displayName: null,
        email: null,
        signInPath: chatGPTSignInPath('/'),
      };

  return <ClientOnlyAac identity={identity} />;
}
