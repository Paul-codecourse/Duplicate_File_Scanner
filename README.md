# Duplicate_File_Scanner
A js file that uses node.js to check for duplicate files - Options exist for scanning specific locations and file types 

To use.

Install the program:-
    1. First open index.html and install the correct files for your system. (Probably would be better to add it to launcher or just run the install executables)

Scanning the drive:-
    1. Then run the launcher and answer the questions (Need to create a tick box automated approach for this rather then the launcher)
    2. The questions select what drive and folder to scan
    3. (Optionally to run the scan manually node duplicateChecker.js drive and folder specific file type. Eg “node duplicateChecker.js c:\ jpg” this will search the c:\ drive looking through all jpg files for duplicates.)
    4. The scan will provide an estimated time
    5. Once the scan is complete a JSON File is created with the current date and time

Selecting files to delete:-
    1. Open the Dashboard (index.html)
    2. Click the choose the file button and load the json file
    3. This will now show a list of files with duplicates
    4. (Need to make the Action bar permanently visible)
    5. Click on one of the file names
    6. Select a file to delete by clicking on the tick box and the Action bar will appear

Action bar buttons:-
-Exclude System Files 		Hides common system files
-Smart Select 			    Selects the newest duplicates, leaving the oldest/original copy
-Deselect			        Deselects all currently selected files
-Copy Paths			        Copies the location path and name of the selected files to the clipboard
-Show Media Only	        Hides all files except for common media file types (this also displays a thumbnail of the image files but not of the video files)

To delete the selected copies:-
    1. Click the Copy Paths button
    2. Open a text file and paste the contents of the clipboard
    3. Save the text file as filestodelete.txt
    4. run the command “node deletefiles.js”