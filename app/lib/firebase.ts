import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

// Copy these values from Firebase Console → Project settings → Your apps.
// They identify the web app, but they are not a service-account private key.
const firebaseConfig = {
  apiKey: "AIzaSyD8RDLnUR9k022MN43LRG7ZBBZCD_LUuas",
  authDomain: "render-video-studio.firebaseapp.com",
  projectId: "render-video-studio",
  storageBucket: "render-video-studio.firebasestorage.app",
  messagingSenderId: "891164001584",
  appId: "1:891164001584:web:b4e4ac1b2d3a9aa424b4f5",
};

const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

const getBrowserAuth = () => {
  if (typeof window === "undefined") {
    throw new Error("Firebase Authentication chỉ hoạt động trong trình duyệt.");
  }
  return getAuth(firebaseApp);
};

const getFirestoreDb = () => getFirestore(firebaseApp);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const FIRESTORE_WORKSPACE_ID = "render-video-default";

const ensureFirebaseConfigured = () => {
  const missing = Object.entries(firebaseConfig).filter(([, value]) =>
    !value || value.startsWith("YOUR_"),
  );

  if (missing.length > 0) {
    throw new Error(
      "Chưa cấu hình Firebase Web App. Hãy điền firebaseConfig trong app/lib/firebase.ts.",
    );
  }
};

export const observeGoogleUser = (
  callback: (user: User | null) => void,
) => {
  if (typeof window === "undefined") return () => undefined;
  return onAuthStateChanged(getBrowserAuth(), callback);
};

export async function signInWithGoogle() {
  ensureFirebaseConfigured();
  const credential = await signInWithPopup(getBrowserAuth(), googleProvider);
  return credential.user;
}

export async function signOutFromGoogle() {
  await signOut(getBrowserAuth());
}

const requireGoogleUser = async () => {
  ensureFirebaseConfigured();
  const auth = getBrowserAuth();
  if (auth.currentUser) return auth.currentUser;

  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
};

const workspaceReference = async () => {
  const user = await requireGoogleUser();
  return doc(
    getFirestoreDb(),
    "users",
    user.uid,
    "workspaces",
    FIRESTORE_WORKSPACE_ID,
  );
};

export async function saveWorkspaceToFirestore(data: unknown) {
  const workspaceRef = await workspaceReference();
  const serializableData = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

  await setDoc(workspaceRef, {
    data: serializableData,
    version: 1,
    clientUpdatedAt: Date.now(),
    updatedAt: serverTimestamp(),
  });

  return {
    success: true,
    acknowledged: true,
    userId: (await requireGoogleUser()).uid,
  };
}

export async function loadWorkspaceFromFirestore() {
  const workspaceRef = await workspaceReference();
  const snapshot = await getDoc(workspaceRef);

  if (!snapshot.exists()) return null;
  return snapshot.data().data ?? null;
}
