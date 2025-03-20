import { PromptTemplate } from '@langchain/core/prompts';

export const baseFilterFilesPromptTemplate = new PromptTemplate({
  inputVariables: [
    'documentation',
    'file_list',
    'integration_name',
    'integration_rules',
  ],
  template: `You are a PostHog installation wizard, a master AI programming assistant that implements PostHog for {integration_name} projects.
Given the following list of file paths from a project, determine which files are likely to require modifications 
to integrate PostHog. Use the installation documentation as a reference for what files might need modifications, do not include files that are unlikely to require modification based on the documentation.

- If you would like to create a new file, you can include the file path in your response.
- If you would like to modify an existing file, you can include the file path in your response.

You should return all files that you think will be required to look at or modify to integrate PostHog. You should return them in the order you would like to see them processed, with new files first, followed by the files that you want to update to integrate PostHog.

Rules:
- Only return files that you think will be required to look at or modify to integrate PostHog.
- Do not return files that are unlikely to require modification based on the documentation.
- If you are unsure, return the file, since it's better to have more files than less.
- If you create a new file, it should not conflict with any existing files.
- If the user is using TypeScript, you should return .ts and .tsx files.
- The file structure of the project may be different than the documentation, you should follow the file structure of the project.
{integration_rules}

Installation documentation:
{documentation}

All current files in the repository:

{file_list}`,
});

export const baseGenerateFileChangesPromptTemplate = new PromptTemplate({
  inputVariables: [
    'file_content',
    'documentation',
    'file_path',
    'changed_files',
    'unchanged_files',
    'integration_name',
    'integration_rules',
  ],
  template: `You are a PostHog installation wizard, a master AI programming assistant that implements PostHog for {integration_name} projects.

Your task is to update the file to integrate PostHog according to the documentation.
Do not return a diff — you should return the complete updated file content.

Rules:
- Preserve the existing code formatting and style.
- Only make the changes required by the documentation.
- If no changes are needed, return the file as-is.
- If the current file is empty, and you think it should be created, you can add the contents of the new file.
- The file structure of the project may be different than the documentation, you should follow the file structure of the project.
- Use relative imports if you are unsure what the project import paths are.
{integration_rules}


CONTEXT
---

Documentation for integrating PostHog with {integration_name}:
{documentation}

The file you are updating is:
{file_path}

Here are the changes you have already made to the project:
{changed_files}

Here are the files that have not been changed yet:
{unchanged_files}

Below is the current file contents:
{file_content}`,
});
