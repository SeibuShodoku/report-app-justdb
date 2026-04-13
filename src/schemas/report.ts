import { z } from "zod";

const launchContextBaseSchema = z.object({
  caseId: z.string().min(1).max(100),
  investigationId: z.string().max(100).optional(),
  constructionId: z.string().max(100).optional(),
  driveFolderId: z.string().max(200).optional(),
  driveFolderUrl: z.string().url().optional(),
  token: z.string().min(20).optional()
});

function requireDriveFolderParam(
  value: { driveFolderUrl?: string; driveFolderId?: string },
  ctx: z.RefinementCtx
) {
  if (!value.driveFolderUrl && !value.driveFolderId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "driveFolderUrl か driveFolderId のいずれかが必要です。"
    });
  }
}

export const launchContextSchema = launchContextBaseSchema.superRefine(
  requireDriveFolderParam
);

export const reportPhotoItemSchema = z.object({
  heading: z.string().max(80).optional(),
  imageUrl: z.string().url(),
  annotationNote: z.string().max(500).optional()
});

export const reportSubmissionSchema = launchContextBaseSchema
  .extend({
    title: z.string().min(1).max(120),
    reporter: z.string().min(1).max(80),
    category: z.string().min(1).max(50),
    coverPhotoUrl: z.string().url().optional(),
    headerSummary: z.string().max(1000).optional(),
    photoItems: z.array(reportPhotoItemSchema).max(8),
    detailFindings: z.string().min(1).max(4000),
    detailActionsTaken: z.string().max(4000).optional(),
    detailNextActions: z.string().max(4000).optional()
  })
  .superRefine(requireDriveFolderParam);

export type LaunchContext = z.infer<typeof launchContextSchema>;
export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;
