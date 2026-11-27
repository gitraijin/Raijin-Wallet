package expo.modules.raijinscan

import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Camera preview that reports QR codes. CameraX for the picture, ZXing for
 * decoding; everything stays on the device.
 */
class RaijinScanView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onScan by EventDispatcher()

  // React Native does not lay out views that native code adds (PreviewView
  // adds its TextureView only once the camera runs). Without this the preview
  // stays 0x0, CameraX never gets a surface and the camera (and torch) never start.
  override val shouldUseAndroidLayout = true

  private val previewView = PreviewView(context).apply {
    // TextureView: lays out like any other view inside React Native.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val reader = MultiFormatReader().apply {
    setHints(
      mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
      ),
    )
  }
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var torch = false
  private var lastText: String? = null
  private var lastAt = 0L

  init {
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    measureChild(previewView, widthMeasureSpec, heightMeasureSpec)
    setMeasuredDimension(
      View.resolveSize(previewView.measuredWidth, widthMeasureSpec),
      View.resolveSize(previewView.measuredHeight, heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    previewView.measure(
      MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY),
    )
    previewView.layout(0, 0, right - left, bottom - top)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  fun setTorch(on: Boolean) {
    torch = on
    camera?.cameraControl?.enableTorch(on)
  }

  private fun start() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      Log.w(TAG, "no lifecycle owner, camera not started")
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!isAttachedToWindow) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
        val analysis = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
          .also { it.setAnalyzer(analysisExecutor, ::analyze) }
        cameraProvider.unbindAll()
        camera = cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        camera?.cameraControl?.enableTorch(torch)
      } catch (e: Exception) {
        Log.w(TAG, "camera start failed", e)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  fun stop() {
    try {
      provider?.unbindAll()
    } catch (e: Exception) {
      Log.w(TAG, "camera stop failed", e)
    }
    camera = null
  }

  /** Luminance (Y plane) is all ZXing needs. Tries the frame as is, then inverted (light-on-dark codes). */
  private fun analyze(image: ImageProxy) {
    try {
      val plane = image.planes[0]
      val buffer = plane.buffer
      val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
      val width = plane.rowStride
      val height = image.height
      val source = PlanarYUVLuminanceSource(data, width, height, 0, 0, image.width, height, false)
      val text = decode(source) ?: decode(source.invert())
      if (text != null) report(text)
    } catch (e: Exception) {
      Log.w(TAG, "analyze failed", e)
    } finally {
      image.close()
    }
  }

  private fun decode(source: com.google.zxing.LuminanceSource): String? =
    try {
      reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: NotFoundException) {
      null
    } finally {
      reader.reset()
    }

  /** The same code again counts only after a pause, like a fresh scan. */
  private fun report(text: String) {
    val now = System.currentTimeMillis()
    if (text == lastText && now - lastAt < 2000) return
    lastText = text
    lastAt = now
    post { onScan(mapOf("data" to text)) }
  }

  companion object {
    private const val TAG = "RaijinScan"
  }
}
