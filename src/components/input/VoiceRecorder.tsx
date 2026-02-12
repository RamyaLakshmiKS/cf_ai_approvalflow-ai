import { Microphone, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button/Button";

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onTranscript,
  onError,
  disabled = false
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    try {
      console.log("[VOICE] Requesting microphone access");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log(
            "[VOICE] Audio chunk received, total chunks:",
            audioChunksRef.current.length
          );
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      console.log("[VOICE] Recording started with mime type:", mimeType);
    } catch (error) {
      console.error("[VOICE] Error accessing microphone:", error);
      onError(
        error instanceof Error ? error.message : "Failed to access microphone"
      );
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    console.log("[VOICE] Stopping recording");
    setIsRecording(false);
    setIsTranscribing(true);

    return new Promise<void>((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve();
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        try {
          console.log(
            "[VOICE] Recording stopped, processing",
            audioChunksRef.current.length,
            "chunks"
          );

          // Stop all tracks in the stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }

          // Create blob from audio chunks
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm"
          });
          console.log(
            "[VOICE] Created audio blob, size:",
            audioBlob.size,
            "bytes"
          );

          // Upload to transcription endpoint
          console.log("[VOICE] Uploading audio to /api/audio/transcribe");
          const formData = new FormData();
          formData.append("audio", audioBlob, "voice.webm");

          const response = await fetch("/api/audio/transcribe", {
            method: "POST",
            body: formData
          });

          if (!response.ok) {
            const errorData = (await response.json()) as { error?: string };
            throw new Error(errorData.error || "Transcription failed");
          }

          const data = (await response.json()) as { text?: string };
          console.log("[VOICE] Transcription result:", data.text);

          if (!data.text || data.text.trim() === "") {
            onError("No speech detected. Please try again.");
            setIsTranscribing(false);
            resolve();
            return;
          }

          onTranscript(data.text);
          setIsTranscribing(false);
          resolve();
        } catch (error) {
          console.error("[VOICE] Error transcribing audio:", error);
          onError(
            error instanceof Error
              ? error.message
              : "Failed to transcribe audio"
          );
          setIsTranscribing(false);
          resolve();
        }
      };

      mediaRecorderRef.current.stop();
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Minimal UI: a single mic button with visual recording state (no visible text)
  return (
    <div>
      <Button
        type="button"
        variant={isRecording ? "secondary" : "ghost"}
        size="md"
        shape="square"
        className={`rounded-full h-9 w-9 flex items-center justify-center ${isRecording ? "bg-red-600 animate-pulse" : ""}`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || isTranscribing}
        aria-label={isRecording ? "Stop recording" : "Start voice recording"}
      >
        {isRecording ? (
          <Stop size={16} className="text-white" />
        ) : (
          <Microphone size={16} />
        )}
      </Button>
    </div>
  );
};
