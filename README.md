# SdIW * Cμ/Later

**An unofficial UoW MIPS CS 230 assembly course(s) learning tool,
a single-step, visual live/interactive interpreter and debugger.**


Supported instructions: `.word`, `add`, `sub`, `mult`, `multu`, 
`div`, `divu`, `mfhi`, `mflo`, `lis`, `lw`, `sw`, `slt`, `sltu`,
`beq`, `bne`, `jr`, `jalr`, `addi`, `j` and `jal`.

> This is quickly concocted contraption is a work in progress,
> so expect bugs and missing features, not exemplary code. 
> It was created to address a short-term need. If you find it
> useful, consider contributing improvements.
>
> **Enjoy responsibly, don't expect anything.**

It supports special `;!!`, `;??` and `;<<` comments that can help set up
tests equivalent to UoW CS 241 tools (twoints, array, arraydump).


Use `;!!` to initialize registers as needed. Use `=`, `<--` or `\u27f5`
as the assignment operator and assign binary, octal, decimal, hex
values or labels (will assign their addresses):

## twoints example:
```
;!! $1 <-- 123           ; first integer input
;!! $2 <-- 456           ; second integer input
```

## array & arraydump example:
```
;!! $1 <-- input_array   ; load address of the array into $1
;!! $2 <-- 5             ; size of the array (number of elements)
```

## Standard Input

Use `;<<` to specify what should STDIN lool like, that your code
should be able to read from the special memory address 0xFFFF0004:

Example:
```
;<< "This will be read as \tstandard input from 0xFFFF0004.\n"
;<< "You can append more.\n"
;<< "You must use \n explicitly to end lines."
```

## Assertions

Use `;??` to add assertions to help find unmet expectations.
A warning popup will show if the assertion isn't true.

```
;?? $1 == array_start  "$1 should be pointing to array_start"
;?? $2 <  6            "Value of $2 should be less than 6"
;?? $1 <= stack_space  "Address in $1 should be before stack_space"
;?? $1 >  $2           "$1 must be greater than $2"
```

## Note

  - Final `jr $31` will stop the program execution.

  - There is no dedicated / separate memory browser.
    Left pane shows the current state of affairs.
    Use `.word 0` for locations you'd like to be able to see.

  - Execution starts from 0x00000000 at the moment.
    If you need another, use `j <label>` instruction.

  - This isn't built to be fast but to visualize (animate)
    execution.

  - Within above CS 230 limits, code that **binasm** supports
    should work here too. With the exception of forcing addresses,
    the opposite is true too - binasm will treat special
    `;!!`, `;<<` and `;??` as mere comments and will ignore them.

  - Try the right-click / context menu.

## License

Licensed under the [MIT License](https://mit-license.org/).
