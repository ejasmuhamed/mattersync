# Mattersync privacy notice — draft for publisher review

Publisher: **Bytsolv Digital Transformations Private Limited**, trading as **Bytsolv**.

Contact: **support@bytsolv.com**. Website: https://bytsolv.com.

This draft describes the repository's default client behavior. Bytsolv must review it against the actual production configuration, server deployment, service providers, distribution markets, and store privacy declarations before publishing it. It is not a replacement for a connected server operator's privacy policy.

## Your team server

Mattersync connects to the Mattermost server you choose. Account credentials, messages, attachments, voice recordings that you choose to send, profile information, and other collaboration data are transmitted to that server to provide the requested functions. The server operator controls account administration, retention, access, integrations, and server-side processing. Contact your administrator for those policies and account or message deletion requests.

Mattersync is an independent client and is not affiliated with or endorsed by Mattermost, Inc.

## Device permissions and local storage

- Microphone access is used when you record a voice message or participate in a call. Voice recordings are created on the device as audio files. Choosing **Attach recording** starts an upload to the selected server before you press **Send**; Send creates the message containing the uploaded attachment. Cancelling before attaching deletes the temporary recording file. Removing a draft does not establish that the server has deleted an attachment already uploaded to it.
- Voice attachments and other downloaded or pending files may be stored in the app's server cache. The app also stores account/session information and local databases needed to sign in and display conversations. Removing the app or its local data affects device storage, not copies already held by the server.
- Camera, photo, and file access support attachments and sharing when you choose those features. Biometric authentication, notifications, and other permissions depend on your device settings and the features or administrator policies you use.

## Notifications, diagnostics, and support

Push notifications, when configured, may use the server's push service and Apple or Google notification infrastructure. Their processing depends on the notification deployment and server settings.

The default repository configuration disables Sentry reporting and provides no Rudder analytics key. This does not establish that every future release or connected server uses the same configuration. Bytsolv must disclose any enabled analytics, crash reporting, or additional service providers before release.

If you choose to contact support or share diagnostic logs, the information you choose to provide is used to investigate your request. Logs and screenshots may contain account, device, or server information; review attachments before sending them. For privacy or support questions, email support@bytsolv.com.

## Before this draft is published

The publisher must confirm its applicable retention/deletion practices for support records, legal bases and jurisdiction-specific disclosures where required, any additional processors or international transfers, and the final production configuration. Publish the reviewed notice at a stable public URL and put that URL in the store listings.
