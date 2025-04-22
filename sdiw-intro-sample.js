const sdiwIntroSample = `
;; Welcome to the SdIW * C\u03BC/Later
;;
;; This is a UoW MIPS CS 230 assembly course(s) learning tool,
;; a single-step, visual live/interactive interpreter and debugger.
;;
;; For the supported instruction set see:
;; https://web.archive.org/web/20250421175919/https://cs.uwaterloo.ca/~b246chen/Notes/CS_230/mipsref.pdf
;;
;; It is a work in progress, so expect bugs and missing features.
;;
;; MIT Licensed. Enjoy responsibly, don't expect anything.

;; It supports special ;!!, ;?? and ;<< comments that can help set up
;; tests equivalent to UoW CS 241 tools (twoints, array, arraydump).


;; Use ;!! to initialize registers as needed. Use =, <-- or \u27f5
;; as the assignment operator and assign binary, octal, decimal, hex
;; values or labels (will assign their addresses):

;; twoints example:
;!! $1 <-- 123           ; first integer input
;!! $2 <-- 456           ; second integer input

;; array & arraydump example:
;!! $1 <-- wordle        ; label where .word array elements begin
;!! $2 <-- 5             ; size of the array (number of elements)


;; Use ;<< to specify what should STDIN lool like, that your code
;; should be able to read from the special memory address 0xFFFF0004:

;; stdin example:
;<< "This will be read as \\tstandard input from 0xFFFF0004.\\r\\n"
;<< "You can append more.\\n"
;<< "You must use \\n explicitly to end lines."


;; Use ;?? to add assertions to help find unmet expectations.
;; A warning popup will show if the assertion isn't true.

;?? $1 == wordle       "$1 should be pointing to wordle"
;?? $2 <  6            "Value of $2 should be less than 6"
;?? $1 <= stack_space  "Address in $1 should be before stack_space"
;?? $1 >  $2           "$1 must be greater than $2"

;; NOTE:
;;   - Final jr $31 will stop the program execution.
;;
;;   - There is no dedicated / separate memory browser. 
;;     Left pane shows the current state of affairs. 
;;     Use .word 0 for locations you'd like to be able to see.
;;
;;   - Execution starts from 0x00000000 at the moment.
;;     If you need another, use j <label> instruction.
;;
;;   - This isn't built to be fast but to visualize (animate)
;;     execution.
;;
;;   - Within above CS 230 limits, code that "binasm" supports
;;     should work here too. With the exception of forcing addresses,
;;     the opposite is true too - binasm will treat special
;;     ;!!, ;<< and ;?? as mere comments and will ignore them.
;;
;;   - Try the right-click menu.
;;-------------------------------------------------------------------
;; Example code:

;; INPUT REGISTERS ($4-$7 by convention)
;;
;; $4 - address of input/output - used in procedures
;;
;; LOCAL VARIABLES ($8-$15, $24, $25 by convention)
;;
;; $8 - temp, various
;; $9 - temp, various
;; $10 - 0xA, newline
;; $11 - current target letter
;; $12 - current guess letter
;; $13 - temp, various
;; $14 - address of the first letter in the target word
;; $15 - address of the first letter in the guess word
;; $24 - address of the current letter in the target word
;; $25 - address of the current letter in the guess word
;;
;; OUTPUT REGISTERS
;;
;; $21 - number of exact matches
;; $22 - number of partial matches
;; $23 - number of no-matches, count of letters to start with
;;
;; OTHER CONVENTIONS
;; 
;; $30 - stack pointer (in MIPS simulator)
;; $31 - return address

;<< \"EMILIA\\n\"
;<< \"AMELIA\\n\"
;!! $30 <-- stack

start:
    ; Store the return address ($31) on stack so we can easily 
    ; use a procedures internally
    addi $30, $30, -4
    sw $31, 0($30)

    ; Reserve space for up to 32 chars (4 bytes each) 
    ; for the target word, remember the start into $11
    addi $30, $30, -128
    add  $14, $30, $0

    ; Reserve space for up to 32 chars (4 bytes each) 
    ; for the guess word, remember the start into $12
    addi $30, $30, -128
    add  $15, $30, $0

    ; Input the target word
    add $4, $14, $0   ; procedure expects the address at $4
    jal input

    ; Input the guess word
    add $4, $15, $0   ; procedure expects the address at $4
    jal input

    ; Call the Wordle calc procedure
    jal wordle

    ; Exit - go back to the caller
    addi $30, $30, 256
    lw $31, 0($30)
    addi $30, $30, 4
    jr $31

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

wordle:
    add $23, $0, $0    ; $23  <- 0  (no letters)
    add $24, $14, $0   ; $24 <- $14 (first letter of target)
    add $25, $15, $0   ; $25 <- $15 (first letter of guess)
    addi $10, $0, 0xA ; newline

count_letters:
    ; did we reach the newline char at target?
    lw $11, 0($24)
    beq $11, $10, newline_found

    ; we should NOT find the newline char at guess...
    lw $12, 0($25)
    beq $12, $10, different_lengths

    ; all good - neither target nor guess are newline

    addi $23, $23, 1    ; increment $23, letter count
    addi $24, $24, 4  ; next target letter
    addi $25, $25, 4  ; next guess letter
    
    beq $0, $0, count_letters

newline_found: ; ... at target, so must be at guess:
    lw $12, 0($25)
    beq $12, $10, lengths_equal

different_lengths:
    ; report error somehow
    addi $21, $0, -1
    addi $22, $0, -1
    addi $23, $0, -1
    jr $31

lengths_equal:
    ; $23 contains the number of letters

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; make working copies and count exact matches at the same time

phase_1: 

    add $24, $14, $0   ; $11 <- $4 (address of first letter of target)
    add $25, $15, $0   ; $12 <- $5 (address of first letter of guess)
        
phase1_loop:
    lw $11, 0($24)    ; get next letter from target 
    lw $12, 0($25)    ; get next letter from guess

    beq $11, $10, phase1_done

    bne $11, $12, phase1_next

    ; we've found an exact match!

    addi $21, $21, 1     ; count it in $21, # of exact matches

    ; replace the exactly matching chars with '.'
    addi $11, $0, 0x2E   ; '.' (dot char), indicates exact match
    add  $12, $11, $0    ; same for $13
    sw $11, 0($24)
    sw $12, 0($25)

phase1_next:
    addi $24, $24, 4
    addi $25, $25, 4

    beq $0, $0, phase1_loop
    
phase1_done:
    lis $9
    .word 0xFFFF000C

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Look for remaining letters in wrong spots

phase2:
    add $25, $15, $0    ; start with the first letter of the guess
    addi $8, $0, 0x2E   ; '.' - dot char to compare with
    addi $9, $0, 0x2B   ; '+' - plus sign to mark partial matches
    addi $13, $0, 0x3F  ; '?' - question mark for non-matches

phase2_guess_loop:
    lw $12, 0($25)     ; load current char of the guess

    ; if the char is newline (0xA, in $10), we're done
    beq $12, $10, phase2_done

    ; if char is '.' ($8) then it was handled in phase 1 as an exact match
    beq $12, $8, phase2_next_guess

    ; ok, neither newline nor '.' - must be a letter
    ; let's try to find it in the target

    add $24, $14, $0   ; start with the first letter of the target

phase2_target_loop:
    lw $11, 0($24)     ; load current char of the target

    ; if we've reached the newline in the target => we haven't found rhe letter
    beq $11, $10, phase2_no_match

    bne $12, $11, phase2_different
    ; we found equal letters in different positions

    addi $22, $22, 1  ; increment count of partial matches
    sw $9, 0($24)     ; destroy used up letter in target 
    sw $9, 0($25)     ; mark the partial match in guess

    beq $0, $0, phase2_next_guess

phase2_different:
    addi $24, $24, 4   ; go to the next char in target
    beq $0, $0, phase2_target_loop

phase2_no_match:
    ; let's mark the unmatched guess char at $25 with '?' (0x3F in $13)
    sw $13, 0($25)

phase2_next_guess:
    addi $25, $25, 4  ; go to the next char in guess
    beq $0, $0, phase2_guess_loop

phase2_done:

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Done! Report stuff.

    ; Store the return address ($31) on stack so we can easily 
    ; use a procedures internally
    addi $30, $30, -4
    sw $31, 0($30)

    ; call the output proc to print the "screen output" - what is left at $15 (guess)

    ; lis $4
    ; .word output_text
    ; jal output

    add $4, $15, $0
    jal output

    lw $31, 0($30)
    addi $30, $30, 4

    ; subtract exact and partial matches from total letter count in $23
    ; to make it the count of non-matches
    sub $23, $23, $21
    sub $23, $23, $22

    jr $31

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; procedure to input text from keyboard, max 31 chars + 0xA
;;
;; register $4 contains the address where to store the chars
;;
input:
    addi $8, $0, 31

    ; Load the address that retrieves the keyboard input
    lis $9
    .word 0xFFFF0004

input_loop:
    lw $10, 0($9)      ; read a single char
    sw $10, 0($4)      ; store it
    addi $4, $4, 4  ; next location to store to

    ; Was that char a newline (0xA)?

    addi $10, $10, -10 ; subtract 0xA from the char
    beq $10, $0, input_done

    addi $8, $8, -1
    beq $8, $0, input_done

    beq $0, $0, input_loop

input_done:
    ; just in case we didn't end with 0xA, store one
    addi $10, $0, 0xA
    sw $10, 0($4)

    ; output a(n) (extra) newline to screen as well
    lis $9
    .word 0xFFFF000C
    sw $10, 0($9)

    jr $31
    
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; procedure to output text from $4, up to first 0xA
;;
output:
    lis $9
    .word 0xFFFF000C

output_loop:
    lw $8, 0($4)
    sw $8, 0($9)

    addi $4, $4, 4     ; next letter address

    ; was it the end?
    addi $8, $8, -10
    bne $8, $0, output_loop

    jr $31

stack_space:
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0
        .word 0        
stack: 
; Other useful stuff - labels for input and output addresses:

0xFFFF0004: stdin:  ; Address of standard input
0xFFFF000C: stdout: ; Address of standard output
`.trimStart();