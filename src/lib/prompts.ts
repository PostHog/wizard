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
- If two files might include the content you need to edit, return both.
- If you create a new file, it should not conflict with any existing files.
- If the user is using TypeScript, you should return .ts and .tsx files.
- The file structure of the project may be different than the documentation, you should follow the file structure of the project. e.g. if there is an existing file containing providers, you should edit that file instead of creating a new one.
{integration_rules}
- Look for existing files that contain providers, components, hooks, etc. and edit those files instead of creating new ones if appropriate.

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
- It's okay not to edit a file if it's not needed (e.g. if you have already edited another one or this one is not needed).
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

export const migrationFilterFilesPromptTemplate = new PromptTemplate({
  inputVariables: [
    'documentation',
    'file_list',
    'source_sdk',
    'integration_rules',
  ],
  template: `You are a PostHog migration wizard, a master AI programming assistant that migrates projects from {source_sdk} to PostHog.
Given the following list of file paths from a project, determine which files contain {source_sdk} code that needs to be migrated to PostHog.

- Look for files that import or use {source_sdk} SDK
- Look for files that initialize {source_sdk}
- Look for files that track events with {source_sdk}
- Look for files that identify users with {source_sdk}
- Look for configuration files that may reference {source_sdk}

You should return all files that contain {source_sdk} code that needs to be migrated. Return them in the order you would like to see them processed.

Rules:
- Only return files that actually contain {source_sdk} code or references
- Do not return files that don't use {source_sdk}
- If you are unsure, return the file, since it's better to have more files than less
- Include any configuration or initialization files
{integration_rules}

Migration documentation:
{documentation}

All current files in the repository:

{file_list}`,
});

export const migrationGenerateFileChangesPromptTemplate = new PromptTemplate({
  inputVariables: [
    'file_content',
    'documentation',
    'file_path',
    'changed_files',
    'unchanged_files',
    'source_sdk',
    'integration_rules',
  ],
  template: `You are a PostHog migration wizard, a master AI programming assistant that migrates projects from {source_sdk} to PostHog.

Your task is to migrate the file from {source_sdk} to PostHog according to the migration documentation.
Do not return a diff — you should return the complete updated file content.

Rules:
- Replace ALL {source_sdk} imports with PostHog imports
- Replace ALL {source_sdk} initialization code with PostHog initialization
- Replace ALL {source_sdk} tracking calls with PostHog equivalents
- Replace ALL {source_sdk} identify calls with PostHog equivalents
- Remove ALL {source_sdk}-specific code that has no PostHog equivalent
- Preserve the existing code formatting and style
- Make sure to remove any unused {source_sdk} imports after migration
- If the file has no {source_sdk} code after review, return it unchanged
{integration_rules}


CONTEXT
---

Migration documentation from {source_sdk} to PostHog:
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
