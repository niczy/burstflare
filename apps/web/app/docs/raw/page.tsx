export const metadata = {
  title: "Raw Docs - BurstFlare",
  description: "Plain text notes for the simplified instance-first model."
};

export default function RawDocsPage() {
  return (
    <pre>{`BurstFlare simplified model

1. Auth
   Sign in with email to open a single-owner workspace.

2. Instances
   Instances define the image, env vars, secrets, startup bootstrap script, persisted paths, and shared /home/flare state.

3. Sessions
   Sessions are the live containers created from an instance.
   /workspace is isolated per session.

4. Storage
   Each session keeps one latest snapshot.
   Each instance keeps one shared /home/flare common-state object.

Key commands
  flare instance create node-dev --image node:20 --bootstrap-file ./bootstrap.sh
  flare session up sandbox --instance <instance-id>
  flare instance push <instance-id>
  flare instance pull <instance-id>`}</pre>
  );
}
