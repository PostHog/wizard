import fg from 'fast-glob';
import path from 'path';
import { GLOBAL_IGNORE_PATTERN } from './file-utils';
import inquirer from 'inquirer';

interface FilePickerOptions {
  message: string;
  placeholder?: string;
  initialValue?: string;
  cwd?: string;
  maxDisplayedFiles?: number;
  suggestedFile?: string;
}

export async function filePickerText(opts: FilePickerOptions): Promise<string> {
  // Dynamically import the ES module
  const autocompletePrompt = (await import('inquirer-autocomplete-prompt' as any)).default;
  inquirer.registerPrompt('autocomplete', autocompletePrompt);

  const cwd = opts.cwd || process.cwd();
  
  // Load all files upfront
  const foundFiles = await fg('**/*', {
    cwd: cwd,
    ignore: GLOBAL_IGNORE_PATTERN,
    onlyFiles: true,
  });
  
  const files = foundFiles
    .map(f => path.relative(cwd, path.join(cwd, f)))
    .sort();

  // Add options for manual entry and skip
  const fileOptions = files.map(file => ({ name: file, value: file }));
  
  // Build options array with suggested file at top if provided
  let allOptions = [];
  
  // Add suggested file first if it exists and is valid
  if (opts.suggestedFile && files.includes(opts.suggestedFile)) {
    allOptions.push({ 
      name: `⭐ ${opts.suggestedFile} (suggested)`, 
      value: opts.suggestedFile 
    });
  }
  
  allOptions.push(
    { name: '⏩ Skip (no location)', value: '__skip__' },
    { name: '✏️  Enter path manually', value: '__manual__' },
    ...fileOptions
  );

  const searchFiles = async (_answersSoFar: any, input: string) => {
    if (!input) {
      // Show first few options when no input
      return allOptions.slice(0, 20);
    }
    
    const searchTerm = input.toLowerCase();
    const filtered = allOptions.filter(option => 
      option.name.toLowerCase().includes(searchTerm)
    );
    
    return filtered.slice(0, 20);
  };

  const answer: any = await inquirer.prompt([
    {
      type: 'autocomplete',
      name: 'file',
      message: opts.message,
      source: searchFiles,
      suggestOnly: false,
      searchText: 'Searching...',
      emptyText: 'No files found!',
    } as any
  ]);

  if (answer.file === '__skip__') {
    return '';
  }

  if (answer.file === '__manual__') {
    const manualAnswer: any = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: 'Enter the file path:',
        default: opts.initialValue || '',
      }
    ]);
    return manualAnswer.path;
  }

  return answer.file;
}