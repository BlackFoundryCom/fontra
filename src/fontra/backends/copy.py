import argparse
import asyncio
import logging
import pathlib
import shutil
from contextlib import aclosing, asynccontextmanager

from ..core.protocols import ReadableFontBackend, WritableFontBackend
from . import getFileSystemBackend, newFileSystemBackend

logger = logging.getLogger(__name__)


async def copyFont(
    sourceBackend: ReadableFontBackend,
    destBackend: WritableFontBackend,
    *,
    glyphNames=None,
    numTasks=1,
    progressInterval=0,
    continueOnError=False,
) -> None:
    if glyphNames is not None:
        from ..workflow.actions.subset import SubsetGlyphs

        subsetter = SubsetGlyphs(glyphNames=glyphNames)
        context = subsetter.connect(sourceBackend)
    else:
        context = async_nullcontext(sourceBackend)

    async with context as sourceBackend:
        return await _copyFont(
            sourceBackend,
            destBackend,
            numTasks=numTasks,
            progressInterval=progressInterval,
            continueOnError=continueOnError,
        )


async def _copyFont(
    sourceBackend: ReadableFontBackend,
    destBackend: WritableFontBackend,
    *,
    numTasks=1,
    progressInterval=0,
    continueOnError=False,
) -> None:
    await destBackend.putFontInfo(await sourceBackend.getFontInfo())
    await destBackend.putAxes(await sourceBackend.getAxes())
    await destBackend.putSources(await sourceBackend.getSources())
    await destBackend.putCustomData(await sourceBackend.getCustomData())
    glyphMap = await sourceBackend.getGlyphMap()
    glyphNamesToCopy = sorted(glyphMap)
    glyphNamesCopied: set[str] = set()

    tasks = [
        asyncio.create_task(
            copyGlyphs(
                sourceBackend,
                destBackend,
                glyphMap,
                glyphNamesToCopy,
                glyphNamesCopied,
                progressInterval,
                continueOnError,
            )
        )
        for i in range(numTasks)
    ]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
    for task in pending:
        task.cancel()
    exceptions: list[BaseException | None] = [
        task.exception() for task in done if task.exception()
    ]
    if exceptions:
        if len(exceptions) > 1:
            logger.error(f"Multiple exceptions were raised: {exceptions}")
        e = exceptions[0]
        assert e is not None
        raise e

    await destBackend.putKerning(await sourceBackend.getKerning())
    await destBackend.putFeatures(await sourceBackend.getFeatures())


async def copyGlyphs(
    sourceBackend: ReadableFontBackend,
    destBackend: WritableFontBackend,
    glyphMap: dict[str, list[int]],
    glyphNamesToCopy: list[str],
    glyphNamesCopied: set[str],
    progressInterval: int,
    continueOnError: bool,
) -> None:
    while glyphNamesToCopy:
        if progressInterval and not (len(glyphNamesToCopy) % progressInterval):
            logger.info(f"{len(glyphNamesToCopy)} glyphs left to copy")
        glyphName = glyphNamesToCopy.pop(0)
        glyphNamesCopied.update(glyphNamesToCopy)
        logger.debug(f"reading {glyphName}")

        try:
            glyph = await sourceBackend.getGlyph(glyphName)
        except Exception as e:
            if not continueOnError:
                raise
            logger.error(f"glyph {glyphName} caused an error: {e!r}")
            continue

        if glyph is None:
            logger.warning(f"glyph {glyphName} not found")
            continue

        logger.debug(f"writing {glyphName}")

        componentNames = {
            compo.name
            for layer in glyph.layers.values()
            for compo in layer.glyph.components
        }
        glyphNamesToCopy.extend(sorted(componentNames - glyphNamesCopied))

        await destBackend.putGlyph(glyphName, glyph, glyphMap[glyphName])


async def mainAsync() -> None:
    logging.basicConfig(
        format="%(asctime)s %(name)-17s %(levelname)-8s %(message)s",
        level=logging.INFO,
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument(
        "--glyph-names",
        help="A comma- or space-separated list of glyph names",
        default="",
    )
    parser.add_argument(
        "--glyph-names-file",
        type=argparse.FileType("r"),
        help="A file containing a space-separated list glyph names",
    )
    parser.add_argument("--progress-interval", type=int, default=0)
    parser.add_argument("--num-tasks", type=int, default=1)
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue copying if reading or processing a glyph causes an error. "
        "The error will be logged, but the glyph will not be present in the output.",
    )

    args = parser.parse_args()

    glyphNames = [
        glyphName for part in args.glyph_names.split(",") for glyphName in part.split()
    ]
    if args.glyph_names_file is not None:
        glyphNames.extend(args.glyph_names_file.read().split())

    sourcePath = pathlib.Path(args.source)
    if not sourcePath.exists():
        raise FileNotFoundError(sourcePath)
    destPath = pathlib.Path(args.destination)
    if args:
        if destPath.is_dir():
            shutil.rmtree(destPath)
        elif destPath.exists():
            destPath.unlink()
    elif destPath.exists():
        raise argparse.ArgumentError(None, "the destination file already exists")

    sourceBackend = getFileSystemBackend(sourcePath)
    destBackend = newFileSystemBackend(destPath)

    # TODO: determine numTasks based on whether either backend supports parallelism

    async with aclosing(sourceBackend), aclosing(destBackend):
        await copyFont(
            sourceBackend,
            destBackend,
            glyphNames=glyphNames if glyphNames else None,
            numTasks=args.num_tasks,
            progressInterval=args.progress_interval,
            continueOnError=args.continue_on_error,
        )


@asynccontextmanager
async def async_nullcontext(item):
    yield item


def main():
    asyncio.run(mainAsync())


if __name__ == "__main__":
    main()
