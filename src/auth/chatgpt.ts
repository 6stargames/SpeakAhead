export type ChatGPTIdentity =
  | {
      displayName: string;
      email: string;
      signOutPath: string;
      signInPath?: never;
    }
  | {
      displayName: null;
      email: null;
      signInPath: string;
      signOutPath?: never;
    };
