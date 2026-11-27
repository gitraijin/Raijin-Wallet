package expo.modules.raijinscan

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RaijinScanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RaijinScan")

    View(RaijinScanView::class) {
      Events("onScan")

      Prop("torch") { view: RaijinScanView, on: Boolean? ->
        view.setTorch(on == true)
      }

      OnViewDestroys { view -> view.stop() }
    }
  }
}
